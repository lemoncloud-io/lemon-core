/**
 * `http-fetch.spec.ts`
 * - parity tests of the `fetch` transport against a local `http.createServer` (no external network).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 initial version (v5 B2-a)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import http from 'http';
import { AddressInfo } from 'net';
import { fetchProxyBody, isJsonBody, toPayload, parseResponseText, HttpFetchRequest } from './http-fetch';

/** one canned reply of the local server */
interface Reply {
    status: number;
    text?: string;
    message?: string;
}

/** canned replies by path. `/echo` is handled separately */
const REPLIES: { [path: string]: Reply } = {
    '/ok': { status: 200, text: '{"hello":"world"}' },
    '/created': { status: 201, text: '{"id":"A1"}' },
    '/no-content': { status: 204 },
    '/not-found': { status: 404, text: '{"error":"no item"}' },
    '/not-found-404': { status: 404, text: '404 NOT FOUND - item' },
    '/bad': { status: 400, text: 'bad input', message: 'Bad Request' },
    '/fail': { status: 500, text: 'boom', message: 'Internal Server Error' },
    '/empty': { status: 200, text: '' },
    '/number': { status: 200, text: '123' },
    '/plain': { status: 200, text: 'hello' },
    '/array': { status: 200, text: '[1,2]' },
};

describe('http-fetch', () => {
    let server: http.Server;
    let base = '';

    // start a local server on a random port.
    beforeAll(async () => {
        server = http.createServer((req, res) => {
            // `/echo` returns method, headers and the raw body as json.
            if (req.url === '/echo') {
                const chunks: Buffer[] = [];
                req.on('data', c => chunks.push(c));
                req.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf8');
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ method: req.method, headers: req.headers, body }));
                });
                return;
            }
            // canned replies.
            const reply = REPLIES[req.url ?? ''] ?? { status: 404, text: '' };
            res.writeHead(reply.status, reply.message ?? http.STATUS_CODES[reply.status]);
            res.end(reply.text ?? undefined);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    // stop the local server.
    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    // shortcut: json GET to the local server.
    const $get = (path: string, json = true) => fetchProxyBody({ method: 'GET', url: `${base}${path}`, json });

    // payload rules: string goes plain, object goes json, null/undefined goes nothing.
    it('should serialize the body once', () => {
        expect(isJsonBody('a')).toBe(false);
        expect(isJsonBody({ a: 1 })).toBe(true);
        expect(toPayload({ a: 1 }, true)).toBe('{"a":1}');
        expect(toPayload('x\ny\n', false)).toBe('x\ny\n');
        expect(toPayload(null, true)).toBe(undefined);
        expect(toPayload(undefined, true)).toBe(undefined);
    });

    // response parsing rules, same as `request` with `json:true`.
    it('should parse response text like request', () => {
        expect(parseResponseText('123', true)).toBe(123);
        expect(parseResponseText('', true)).toBe(undefined);
        expect(parseResponseText('', false)).toBe('');
        expect(parseResponseText('hello', true)).toBe('hello');
        expect(parseResponseText('{"a":1}', false)).toBe('{"a":1}');
    });

    // success codes: 200 and 201 only.
    it('should resolve 200 and 201', async () => {
        expect(await $get('/ok')).toEqual({ hello: 'world' });
        expect(await $get('/created')).toEqual({ id: 'A1' });
        expect(await $get('/array')).toEqual([1, 2]);
        expect(await $get('/ok', false)).toEqual({ hello: 'world' }); // the `{`·`[` re-parse step
    });

    // other 2xx is rejected, as before.
    it('should reject 204', async () => {
        await expect($get('/no-content')).rejects.toThrow('204 No Content - No Content');
    });

    // 400·404 message formats.
    it('should reject 400 and 404 with the v4 message', async () => {
        await expect($get('/not-found')).rejects.toThrow('404 NOT FOUND - {"error":"no item"}');
        await expect($get('/not-found-404')).rejects.toThrow(/^404 NOT FOUND - item$/);
        await expect($get('/bad')).rejects.toThrow('400 BAD REQUEST - bad input');
    });

    // other error status format.
    it('should reject 500 with status message', async () => {
        await expect($get('/fail')).rejects.toThrow('500 Internal Server Error - boom');
    });

    // body edge cases: empty → undefined, number text → number, plain text kept.
    it('should parse empty, number and plain bodies', async () => {
        expect(await $get('/empty')).toBe(undefined);
        expect(await $get('/empty', false)).toBe('');
        expect(await $get('/number')).toBe(123);
        expect(await $get('/number', false)).toBe('123');
        expect(await $get('/plain')).toBe('hello');
    });

    // json request: stringified body, accept and content-type defaults.
    it('should send a json body with json headers', async () => {
        const req: HttpFetchRequest = { method: 'POST', url: `${base}/echo`, json: true };
        req.payload = toPayload({ a: 1 }, true);
        const res = await fetchProxyBody(req);
        expect(res.method).toBe('POST');
        expect(res.body).toBe('{"a":1}');
        expect(res.headers['accept']).toBe('application/json');
        expect(res.headers['content-type']).toBe('application/json');
    });

    // given headers win over the json defaults.
    it('should keep given accept and content-type', async () => {
        const headers = { Accept: 'text/plain', 'Content-Type': 'application/x-ndjson', 'X-Relay': 7 };
        const req: HttpFetchRequest = { method: 'PUT', url: `${base}/echo`, json: true, headers, payload: '{}' };
        const res = await fetchProxyBody(req);
        expect(res.headers['accept']).toBe('text/plain');
        expect(res.headers['content-type']).toBe('application/x-ndjson');
        expect(res.headers['x-relay']).toBe('7');
    });

    // NDJSON string body goes as-is in plain mode (bulk).
    it('should pass an NDJSON string body through', async () => {
        const ndjson = '{"index":{"_id":"1"}}\n{"a":1}\n';
        const headers = { 'Content-Type': 'application/json' };
        const req: HttpFetchRequest = { method: 'POST', url: `${base}/echo`, json: false, headers };
        req.payload = toPayload(ndjson, isJsonBody(ndjson));
        const res = await fetchProxyBody(req);
        expect(res.body).toBe(ndjson);
        expect(res.headers['accept']).not.toBe('application/json'); // fetch default, no json accept
    });

    // GET never sends a body.
    it('should drop the body of GET', async () => {
        const res = await fetchProxyBody({ method: 'GET', url: `${base}/echo`, json: true, payload: '{}' });
        expect(res.method).toBe('GET');
        expect(res.body).toBe('');
    });

    // network error keeps the errno in the message.
    it('should reject ECONNREFUSED with the code in the message', async () => {
        // find a free port, then close it.
        const tmp = http.createServer();
        await new Promise<void>(resolve => tmp.listen(0, '127.0.0.1', () => resolve()));
        const port = (tmp.address() as AddressInfo).port;
        await new Promise<void>(resolve => tmp.close(() => resolve()));
        await expect(fetchProxyBody({ method: 'GET', url: `http://127.0.0.1:${port}/x`, json: true })).rejects.toThrow(
            /^ECONNREFUSED /,
        );
    });
});
