/**
 * `api-service.b18.spec.ts`
 * - v5 B18-c: `APIService` clients, recorders and the http-web proxy with a fake transport (no network, no disk).
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B18-c initial version
 *
 * @copyright   (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

//* v5 B18: the transport echoes the request; `fail` in the url rejects, `wrap` wraps it in `result`.
vi.mock('../../lib/http-fetch', async importOriginal => {
    const org: any = await importOriginal();
    const fetchProxyBody = vi.fn(async (req: any) => {
        if (`${req.url}`.includes('fail')) throw new Error('500 B18 FAIL');
        const echo = { method: req.method, url: req.url, headers: req.headers, payload: req.payload };
        return `${req.url}`.includes('wrap') ? { result: echo } : echo;
    });
    return { ...org, fetchProxyBody };
});

import fs from 'fs';
import { APIService, APIProxyClient, APIServiceClient, MocksAPIService, createHttpWebProxy } from './api-service';

//* a client that records each call.
const fakeClient = (name = 'fake'): APIServiceClient & { calls: any[] } => {
    const calls: any[] = [];
    const rec =
        (method: string) =>
        async (...args: any[]) => {
            calls.push([method, ...args]);
            if (args[0] === 'fail') throw new Error('B18 FAIL');
            if (args[0] === 'raw') throw 'B18 RAW'; // eslint-disable-line no-throw-literal
            return { method, args };
        };
    return {
        calls,
        hello: () => name,
        doGet: rec('GET'),
        doPut: rec('PUT'),
        doPost: rec('POST'),
        doPatch: rec('PATCH'),
        doDelete: rec('DELETE'),
    };
};

describe('api-service B18', () => {
    //* v5 B18: the recorders write files; fs is stubbed so nothing touches the disk.
    let written: { file: string; text: string }[] = [];
    beforeEach(() => {
        written = [];
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);
        vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
        vi.spyOn(fs, 'writeFileSync').mockImplementation((file: any, text: any) => {
            written.push({ file: `${file}`, text: `${text}` });
        });
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('B18 APIProxyClient delegates every method', async () => {
        const target = fakeClient();
        const $c = new APIProxyClient(target);
        expect($c.hello()).toEqual('fake');
        await $c.doGet('a', 'b', { p: 1 }, { b: 1 }, 'h');
        await $c.doPut('a');
        await $c.doPost('a');
        await $c.doPatch('a');
        await $c.doDelete('a');
        expect(target.calls.map(c => c[0])).toEqual(['GET', 'PUT', 'POST', 'PATCH', 'DELETE']);
        expect(target.calls[0]).toEqual(['GET', 'a', 'b', { p: 1 }, { b: 1 }, 'h']);
    });

    it('B18 APIService constructor errors and client methods', async () => {
        expect(() => new APIService('t', '')).toThrow('@endpoint (url) is required');
        expect(() => new APIService('t', 'ftp://x')).toThrow('@endpoint (url) is not valid http-url:ftp://x');
        expect(() => APIService.buildClient('t', '')).toThrow('@endpoint (url) is required');
        const target = fakeClient();
        const $api = new APIService('t', 'https://b18.invalid', {}, target);
        expect((await $api.doPut('a', 'c', { p: 1 }, { b: 2 })).method).toEqual('PUT');
        expect((await $api.doPost('a')).method).toEqual('POST');
        expect((await $api.doPatch('a')).method).toEqual('PATCH');
        expect((await $api.doDelete('a')).method).toEqual('DELETE');
        //* sub-type client: `<type>/<id>/<cmd>`.
        const sub = $api.buildSubTypeClient('items');
        expect(sub.hello()).toEqual('sub-typed:api-service:fake');
        await sub.doPut('1', 'go');
        await sub.doPost('1');
        await sub.doPatch('1');
        await sub.doDelete(null);
        expect(target.calls.slice(4).map(c => c.slice(0, 3))).toEqual([
            ['PUT', 'items', '1/go'],
            ['POST', 'items', '1'],
            ['PATCH', 'items', '1'],
            ['DELETE', 'items', ''],
        ]);
    });

    it('B18 backbone client: host/path via the `web` relay, result key, headers', async () => {
        const client = APIService.buildClient('items', 'https://b18.invalid/api', { k: 'v' }, 'http://b18-bb.invalid');
        expect(client.hello()).toEqual('api-client:http-web-proxy:WEB:b18.invalid-items');
        const res: any = await client.doPut('1', 'go', { q: 1 }, { b: 1 });
        expect(res.method).toEqual('PUT');
        expect(res.url).toEqual('http://b18-bb.invalid/web/https%3A%2F%2Fb18.invalid/%2Fapi%2Fitems%2F1%2Fgo?q=1');
        expect(res.headers).toEqual({ 'x-lemon-k': 'v' });
        expect((await client.doPost('1')).method).toEqual('POST');
        expect((await client.doPatch('1')).method).toEqual('PATCH');
        expect((await client.doDelete('1')).method).toEqual('DELETE');
        //* `result` key unwraps the relay response.
        const wrap = APIService.buildClient('wrap', 'https://b18.invalid', undefined, 'http://b18-bb.invalid');
        expect(((await wrap.doGet('1')) as any).method).toEqual('GET');
        //* a base without scheme gets `http://`.
        const bare: any = new (APIService as any).ProxyServiceClient(
            { hello: () => 'p', doProxy: async (...a: any[]) => a },
            'b18.invalid',
            't',
        );
        const [, host, path] = await bare.doGet('i', 'c');
        expect([host, path]).toEqual(['http://b18.invalid', '/t/i/c']);
    });

    it('B18 createHttpWebProxy() errors and failure', async () => {
        expect(() => createHttpWebProxy('x', '')).toThrow('@endpoint (url) is required!');
        const $px = createHttpWebProxy('x', 'https://b18.invalid/fail');
        expect(() => $px.doProxy(null)).toThrow('@method is required!');
        await expect($px.doProxy('GET', 'a')).rejects.toThrow('500 B18 FAIL');
    });

    it('B18 ApiHttpProxyRecorder records data and errors', async () => {
        const Recorder = APIService.ApiHttpProxyRecorder;
        Recorder.next = 1;
        const target = {
            hello: () => 'tgt',
            doProxy: vi.fn(async (method: string, host: string) => {
                if (host.includes('fail')) throw new Error('B18 FAIL');
                if (host.includes('obj')) throw { code: 'B18' }; // eslint-disable-line no-throw-literal
                if (host.includes('num')) throw 7; // eslint-disable-line no-throw-literal
                return { ok: method };
            }),
        };
        const $rec = new Recorder(target as any, 'b18-logs');
        expect($rec.hello()).toEqual('recorder:tgt');
        expect(await $rec.doProxy('GET', 'b18.invalid', '/a', { q: 1 })).toEqual({ ok: 'GET' });
        expect(written[0].file).toMatch(/^b18-logs\/R\d{8}\/P00001\.json$/);
        expect(JSON.parse(written[0].text).param).toMatchObject({ method: 'GET', endpoint: 'http://b18.invalid/a' });
        await expect($rec.doProxy('POST', 'https://fail.invalid', '/b')).rejects.toThrow('B18 FAIL');
        expect(JSON.parse(written[1].text).error).toEqual('B18 FAIL');
        await expect($rec.doProxy('POST', 'http://obj.invalid', '')).rejects.toEqual({ code: 'B18' });
        expect(JSON.parse(written[2].text).error).toEqual('{"code":"B18"}');
        await expect($rec.doProxy('POST', 'num', '')).rejects.toEqual(7);
        expect(JSON.parse(written[3].text).error).toEqual('7');
        //* default folder; index 0 and negative names.
        Recorder.next = -2;
        const $rec2 = new Recorder(target as any);
        await $rec2.doProxy('GET', 'h', '/x');
        await $rec2.doProxy('GET', 'h', '/x');
        expect(written[4].file).toMatch(/^\.\/logs\/R\d{8}\/PN2\.json$/);
        expect(written[5].file).toMatch(/PN1\.json$/);
    });

    it('B18 APIServiceClientRecorder methods and errors', async () => {
        const Recorder = APIService.APIServiceClientRecorder;
        Recorder.next = 1;
        const target = fakeClient('tgt');
        const $api = new APIService('t', 'https://b18.invalid', {}, target);
        const $rec = $api.buildRecorder('b18-logs') as InstanceType<typeof Recorder>;
        expect($rec.hello()).toEqual('recorder:api-service:tgt');
        await $rec.doPut('a');
        await $rec.doPost('a');
        await $rec.doPatch('a');
        await $rec.doDelete('a');
        expect(target.calls.map(c => c[0])).toEqual(['PUT', 'POST', 'PATCH', 'DELETE']);
        expect(written.map(w => w.file.split('/').pop())).toEqual([
            'D00001.json',
            'D00002.json',
            'D00003.json',
            'D00004.json',
        ]);
        await expect($rec.doGet('fail')).rejects.toThrow('B18 FAIL');
        await expect($rec.doRecord('HEAD' as any, 'a')).rejects.toThrow('@method is not valid. method:HEAD');
        await expect($rec.doGet('raw')).rejects.toEqual('B18 RAW');
        expect(JSON.parse(written[written.length - 1].text).error).toEqual('B18 RAW');
        //* sub-type with recording.
        const sub = $api.buildSubTypeClient('items', true, 'b18-logs');
        expect(sub.hello()).toEqual('recorder:sub-typed:api-service:tgt');
    });

    it('B18 MocksAPIService error forms and methods', async () => {
        const $mock = new MocksAPIService('t', 'api://b18');
        //* v5 B18: a prepared map (no mock files read).
        (($mock as any).$map as any) = {
            'GET api://b18/t/j': { error: '{"status":400}' },
            'GET api://b18/t/s': { error: '400 B18 ERR' },
            'GET api://b18/t/o': { error: { code: 1 } },
            'PUT api://b18/t/1': { data: { m: 'PUT' } },
            'POST api://b18/t/1/go': { data: { m: 'POST' } },
            'PATCH api://b18/t/1': { data: { m: 'PATCH' } },
            'DELETE api://b18/t/1': { data: null },
        };
        await expect($mock.doGet('j')).rejects.toEqual({ status: 400 });
        await expect($mock.doGet('s')).rejects.toThrow('400 B18 ERR');
        await expect($mock.doGet('o')).rejects.toEqual({ code: 1 });
        expect(await $mock.doPut('1')).toEqual({ m: 'PUT' });
        expect(await $mock.doPost('1', 'go')).toEqual({ m: 'POST' });
        expect(await $mock.doPatch('1')).toEqual({ m: 'PATCH' });
        expect(await $mock.doDelete('1')).toEqual(null);
    });
});
