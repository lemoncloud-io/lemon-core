/**
 * `tools/local-gateway/e2e.b20.spec.ts`
 * - v5 B20: end-to-end over a real listening server: `buildExpress()` + the real `LambdaWEBHandler` + a real handler.
 * - bytes are checked on the wire (sha256 / `Buffer.equals`): `{proxy+}`, octet-stream, multipart, binary download.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import crypto from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildEngine } from '../../engine';
import { LambdaHandler } from '../../cores/lambda/lambda-handler';
import { LambdaWEBHandler } from '../../cores/lambda/lambda-web-handler';
import { buildExpress } from '../express';

//* v5 B20: the fixture `serverless.yml` (`/{type}/{proxy+}` ANY, `binaryMediaTypes`, route `cors`).
const FIXTURE = 'src/tools/local-gateway/fixtures/serverless.gateway.yml';

//* v5 B20: sha256 (hex) of bytes.
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

//* v5 B20: a small PNG-like payload (signature, 0x00, 0xff, CR/LF).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0xff, 0x0d, 0x0a]);

//* v5 B20: 4 KB with every byte value.
const BLOB = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 31 + 7) % 256));

//* v5 B20: a raw http reply (status, headers, body bytes as received).
interface Reply {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

describe('local-gateway e2e over a real server (B20)', () => {
    let server: http.Server;
    let port = 0;

    //* v5 B20: one request on loopback, the body collected as raw bytes.
    const call = (method: string, path: string, headers: Record<string, string> = {}, body?: Buffer): Promise<Reply> =>
        new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, method, path, headers }, res => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () =>
                    resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
                );
                res.on('error', reject);
            });
            req.on('error', reject);
            req.end(body);
        });

    //* v5 B20: JSON of a reply body.
    const json = (r: Reply): any => JSON.parse(r.body.toString('utf8'));

    beforeAll(async () => {
        const $web = new LambdaWEBHandler(new LambdaHandler(), true);
        //* v5 B20: `blobs` echoes what the handler receives (id/cmd, body kind and bytes), or returns PNG bytes.
        $web.setHandler('blobs', (mode, id, cmd) => async (i: string, param: any, body: any) => {
            if (mode === 'GET' && cmd === 'png') return PNG;
            const kind = Buffer.isBuffer(body) ? 'buffer' : body?.file ? 'multipart' : typeof body;
            const info: any = { mode, id: i, cmd: cmd || '', kind };
            if (kind === 'buffer') Object.assign(info, { size: body.length, sha: sha(body) });
            if (kind === 'multipart') {
                const f = body.file;
                const file = { originalname: f.originalname, mimetype: f.mimetype, size: f.size, sha: sha(f.buffer) };
                Object.assign(info, { note: body.note, file });
            }
            if (kind === 'object') info.body = body;
            return info;
        });
        const { createServer } = buildExpress(buildEngine({}), $web, {
            serverlessFile: FIXTURE,
            argv: ['node', 'run', '--port', '0'],
        });
        server = createServer();
        //* v5 B20: wait for `listening` only (port 0 → an ephemeral loopback port).
        await new Promise<void>(resolve => (server.listening ? resolve() : server.once('listening', () => resolve())));
        port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    });

    //* v5 B20: `{proxy+}` → id = first segment, cmd = the rest (no body → null).
    it('should map {proxy+} to id and cmd (B20)', async () => {
        const res = await call('GET', '/blobs/a/b/c');
        expect([res.status, json(res)]).toEqual([
            200,
            { mode: 'GET', id: 'a', cmd: 'b/c', kind: 'object', body: null },
        ]);
    });

    //* v5 B20: octet-stream upload → the handler gets a Buffer with the same bytes.
    it('should pass an octet-stream upload as a Buffer (B20)', async () => {
        const res = await call('POST', '/blobs/up/raw', { 'Content-Type': 'application/octet-stream' }, BLOB);
        expect([res.status, json(res)]).toEqual([
            200,
            { mode: 'POST', id: 'up', cmd: 'raw', kind: 'buffer', size: 4096, sha: sha(BLOB) },
        ]);
    });

    //* v5 B20: multipart (a text field + a png file) → `{ note, file{ originalname, mimetype, size, buffer } }`.
    it('should parse a multipart upload into fields and file (B20)', async () => {
        const boundary = 'e2eB20boundary';
        const multipart = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n`),
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="up.png"\r\n`),
            Buffer.from('Content-Type: image/png\r\n\r\n'),
            PNG,
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        const type = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
        const res = await call('POST', '/blobs/up/form', type, multipart);
        expect([res.status, json(res)]).toEqual([
            200,
            {
                mode: 'POST',
                id: 'up',
                cmd: 'form',
                kind: 'multipart',
                note: 'hello',
                file: { originalname: 'up.png', mimetype: 'image/png', size: PNG.length, sha: sha(PNG) },
            },
        ]);
    });

    //* v5 B20: a Buffer result with a binary `Accept` → the exact bytes on the wire.
    it('should send a Buffer result as exact bytes (B20)', async () => {
        const res = await call('GET', '/blobs/dl/png', { Accept: 'image/png' });
        expect([res.status, res.headers['content-type'], res.headers['content-length']]).toEqual([
            200,
            'application/octet-stream',
            `${PNG.length}`,
        ]);
        expect(res.body.equals(PNG)).toBe(true);
        expect(sha(res.body)).toBe(sha(PNG));
    });

    //* v5 B20: a JSON body stays text (not base64) → an object in the handler.
    it('should pass a JSON body as an object (B20)', async () => {
        const res = await call('POST', '/blobs/j/x', { 'Content-Type': 'application/json' }, Buffer.from('{"a":1}'));
        expect([res.status, json(res)]).toEqual([
            200,
            { mode: 'POST', id: 'j', cmd: 'x', kind: 'object', body: { a: 1 } },
        ]);
    });

    //* v5 B20: unknown path, or a literal resource without the method → 403 Missing Authentication Token.
    it('should answer 403 for an unknown path or method (B20)', async () => {
        for (const [method, path] of [
            ['GET', '/nowhere'],
            ['DELETE', '/hello/world'],
        ]) {
            const res = await call(method, path);
            expect([method, path, res.status, res.body.toString('utf8'), res.headers['x-amzn-errortype']]).toEqual([
                method,
                path,
                403,
                '{"message":"Missing Authentication Token"}',
                'MissingAuthenticationTokenException',
            ]);
        }
    });

    //* v5 B20: `OPTIONS /hello` → the configured route `cors` (`custom.cors`).
    it('should answer CORS preflight with the configured headers (B20)', async () => {
        const res = await call('OPTIONS', '/hello', { Origin: 'http://localhost:3000' });
        expect([
            res.status,
            res.headers['access-control-allow-origin'],
            res.headers['access-control-allow-headers'],
            res.headers['access-control-allow-methods'],
            res.headers['access-control-allow-credentials'],
            res.headers['access-control-max-age'],
        ]).toEqual([200, 'http://localhost:3000', 'Content-Type,X-Lemon-Identity', 'GET,OPTIONS', 'true', '600']);
    });
});
