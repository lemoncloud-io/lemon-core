/**
 * `lambda-web-handler.b20.spec.ts`
 * - v5 B20: `{proxy+}`/`{cmd+}` path parameters, base64 request bodies (text, multipart, `Buffer`),
 *   and the `isBase64Encoded` flag of the response.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B20).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it } from 'vitest';
import { NextDecoder } from 'lemon-model';
import { expect2 } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaWEBHandler, buildResponse } from './lambda-web-handler';
import { LambdaHandler } from './lambda-handler';
import { FileInfo } from '../../lib/multipart';

//* v5 B20: what the next handler got (mode, id, cmd, param, body).
interface Received {
    mode: string;
    id: string;
    cmd: string;
    param: any;
    body: any;
}

//* v5 B20: a web handler with one `files` type, which keeps the last call.
const instance = () => {
    const service = new LambdaWEBHandler(new LambdaHandler(), true);
    const box: { last?: Received } = {};
    const decoder: NextDecoder = (mode, id, cmd) => async (i, param, body) => {
        box.last = { mode, id: i, cmd, param, body };
        return { ok: 1 };
    };
    service.setHandler('files', decoder);
    service.setHandler('hello', decoder);
    return { service, box };
};

//* v5 B20: a fresh API Gateway event (sample) for the given resource, path parameters and body.
const eventOf = (options: {
    resource: string;
    path: string;
    pathParameters: { [key: string]: string };
    method?: string;
    contentType?: string;
    body?: string;
    isBase64Encoded?: boolean;
}): any => {
    const event: any = loadJsonSync('data/samples/events/sample.event.web.json');
    event.resource = options.resource;
    event.path = options.path;
    event.pathParameters = options.pathParameters;
    event.httpMethod = options.method || 'GET';
    if (options.contentType) event.headers['content-type'] = options.contentType;
    event.body = options.body === undefined ? null : options.body;
    event.isBase64Encoded = options.isBase64Encoded ?? false;
    return event;
};

//* v5 B20: run the event through `packContext()` + `handle()`, and return the response and the call.
const run = async (event: any) => {
    const { service, box } = instance();
    const $ctx = await service.packContext(event, null);
    const res = await service.handle(event, $ctx);
    return { res, last: box.last, $ctx };
};

//* v5 B20: a multipart body from parts (`Buffer` content keeps any byte).
const multipartOf = (
    boundary: string,
    parts: { name: string; filename?: string; type?: string; content: string | Buffer }[],
): Buffer =>
    Buffer.concat([
        ...parts.map(p =>
            Buffer.concat([
                Buffer.from(
                    `--${boundary}\r\n` +
                        `Content-Disposition: form-data; name="${p.name}"` +
                        (p.filename !== undefined ? `; filename="${p.filename}"` : '') +
                        '\r\n' +
                        (p.type ? `Content-Type: ${p.type}\r\n` : '') +
                        '\r\n',
                ),
                Buffer.isBuffer(p.content) ? p.content : Buffer.from(p.content),
                Buffer.from('\r\n'),
            ]),
        ),
        Buffer.from(`--${boundary}--\r\n`),
    ]);

const b64 = (s: string | Buffer) => (Buffer.isBuffer(s) ? s : Buffer.from(s)).toString('base64');

//! main test body.
describe('LambdaWEBHandler B20 path', () => {
    //* `/files/{proxy+}` with `a/b/c` → id `a`, cmd `b/c`.
    it('should map B20 {proxy+} to id and cmd', async () => {
        const e1 = eventOf({ resource: '/files/{proxy+}', path: '/files/a/b/c', pathParameters: { proxy: 'a/b/c' } });
        const r1 = await run(e1);
        expect2(() => r1.res.statusCode).toEqual(200);
        expect2(() => r1.last, 'mode,id,cmd').toEqual({ mode: 'GET', id: 'a', cmd: 'b/c' });
        //* the source of the context is built from the mapped path too.
        expect2(() => `${r1.$ctx.source}`.split('#')[0].endsWith('/files/a/b/c')).toEqual(true);

        //* one segment → id only (cmd empty).
        const r2 = await run(
            eventOf({ resource: '/files/{proxy+}', path: '/files/a', pathParameters: { proxy: 'a' } }),
        );
        expect2(() => r2.last, 'mode,id,cmd').toEqual({ mode: 'GET', id: 'a', cmd: '' });

        //* empty proxy → LIST.
        const r3 = await run(eventOf({ resource: '/files/{proxy+}', path: '/files/', pathParameters: { proxy: '' } }));
        expect2(() => r3.last, 'mode,id,cmd').toEqual({ mode: 'LIST', id: '', cmd: '' });

        //* values are used as delivered (API Gateway decoded them): no second decode of `%`.
        const r4 = await run(
            eventOf({ resource: '/files/{proxy+}', path: '/files/x', pathParameters: { proxy: 'hello world/100%25' } }),
        );
        expect2(() => r4.last, 'id,cmd').toEqual({ id: 'hello world', cmd: '100%25' });

        //* `/{type}/{proxy+}` → type from the path parameter.
        const r5 = await run(
            eventOf({
                resource: '/{type}/{proxy+}',
                path: '/files/k/v',
                pathParameters: { type: 'files', proxy: 'k/v' },
            }),
        );
        expect2(() => r5.last, 'id,cmd').toEqual({ id: 'k', cmd: 'v' });

        //* `/files/{id}/{proxy+}` → cmd is the whole proxy.
        const r6 = await run(
            eventOf({
                resource: '/files/{id}/{proxy+}',
                path: '/files/k/v/w',
                pathParameters: { id: 'k', proxy: 'v/w' },
            }),
        );
        expect2(() => r6.last, 'id,cmd').toEqual({ id: 'k', cmd: 'v/w' });
    });

    //* `/hello/{id}/{cmd+}` → cmd keeps `/`.
    it('should pass B20 {cmd+} greedy cmd', async () => {
        const event = eventOf({
            resource: '/hello/{id}/{cmd+}',
            path: '/hello/abc/x/y/z',
            pathParameters: { id: 'abc', cmd: 'x/y/z' },
        });
        const { res, last } = await run(event);
        expect2(() => res.statusCode).toEqual(200);
        expect2(() => last, 'mode,id,cmd').toEqual({ mode: 'GET', id: 'abc', cmd: 'x/y/z' });
    });

    //* no `proxy` → the same as before.
    it('should keep B20 behaviour without proxy', async () => {
        const r1 = await run(
            eventOf({ resource: '/hello/{id}/{cmd}', path: '/hello/a/b', pathParameters: { id: 'a', cmd: 'b' } }),
        );
        expect2(() => r1.last, 'mode,id,cmd').toEqual({ mode: 'GET', id: 'a', cmd: 'b' });
        const r2 = await run(eventOf({ resource: '/hello', path: '/hello', pathParameters: null }));
        expect2(() => r2.last, 'mode,id,cmd').toEqual({ mode: 'LIST', id: '', cmd: '' });
    });
});

describe('LambdaWEBHandler B20 body', () => {
    const post = (contentType: string, body: string, isBase64Encoded: boolean) =>
        eventOf({
            resource: '/hello/{id}',
            path: '/hello/a',
            pathParameters: { id: 'a' },
            method: 'POST',
            contentType,
            body,
            isBase64Encoded,
        });

    //* base64 json/text/form → the same as plain.
    it('should decode B20 base64 textual bodies like plain', async () => {
        const cases: [string, string][] = [
            ['application/json; charset=utf-8', JSON.stringify({ a: 1, b: '한글' })],
            ['text/plain', 'hello\nworld'],
            ['application/x-www-form-urlencoded', 'a=1&b=two'],
            ['application/vnd.api+json', '{"x":[1,2]}'],
            ['application/xml', '<?xml version="1.0"?><a/>'],
        ];
        for (const [type, text] of cases) {
            const plain = await run(post(type, text, false));
            const based = await run(post(type, b64(text), true));
            expect2(() => based.res.statusCode).toEqual(200);
            expect2(() => based.last.body).toEqual(plain.last.body);
        }
        //* the json case is parsed (not a string).
        expect2((await run(post('application/json', b64('{"a":1}'), true))).last.body).toEqual({ a: 1 });
    });

    //* base64 octet-stream → `Buffer` with the same bytes.
    it('should pass B20 base64 octet-stream as Buffer', async () => {
        const bytes = Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x7b, 0x7d, 0x80]);
        const { last } = await run(post('application/octet-stream', b64(bytes), true));
        expect2(() => Buffer.isBuffer(last.body)).toEqual(true);
        expect2(() => (last.body as Buffer).equals(bytes)).toEqual(true);
        //* image types too.
        const r2 = await run(post('image/png', b64(bytes), true));
        expect2(() => Buffer.isBuffer(r2.last.body) && r2.last.body.equals(bytes)).toEqual(true);
    });

    //* plain (not base64) octet-stream → unchanged (string).
    it('should keep B20 plain body when not base64', async () => {
        const { last } = await run(post('application/octet-stream', 'raw-text', false));
        expect2(() => last.body).toEqual('raw-text');
    });

    //* multipart with 2 fields + 1 file (binary bytes incl. `\r\n` and 0x00).
    it('should parse B20 multipart with fields and one file', async () => {
        const boundary = '----WebKitFormBoundaryAbC123';
        const fileBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x1a, 0x0a, 0x2d, 0x2d, 0x00]);
        const body = multipartOf(boundary, [
            { name: 'title', content: 'hello 한글' },
            { name: 'note', content: 'line1\r\nline2' },
            { name: 'upload', filename: 'a b.png', type: 'image/png', content: fileBytes },
        ]);
        const { res, last } = await run(post(`multipart/form-data; boundary=${boundary}`, b64(body), true));
        expect2(() => res.statusCode).toEqual(200);
        const $body = last.body;
        expect2(() => $body, 'title,note').toEqual({ title: 'hello 한글', note: 'line1\r\nline2' });
        const file: FileInfo = $body.file;
        expect2(() => file, 'fieldname,originalname,encoding,mimetype,size').toEqual({
            fieldname: 'upload',
            originalname: 'a b.png',
            encoding: '7bit',
            mimetype: 'image/png',
            size: fileBytes.length,
        });
        expect2(() => file.buffer.equals(fileBytes)).toEqual(true);
        expect2(() => $body.files.length).toEqual(1);
        expect2(() => $body.files[0] === file).toEqual(true);
        expect2(() => Object.keys($body).sort()).toEqual(['file', 'files', 'note', 'title']);
    });

    //* multipart with two files → `files` only.
    it('should parse B20 multipart with two files', async () => {
        const boundary = 'xYz';
        const body = multipartOf(boundary, [
            { name: 'f1', filename: 'one.bin', content: Buffer.from([1, 2, 3]) },
            { name: 'f2', filename: 'two.txt', type: 'text/plain', content: 'two' },
            { name: 'k', content: 'v' },
        ]);
        const { last } = await run(post(`multipart/form-data; boundary="${boundary}"`, b64(body), true));
        const $body = last.body;
        expect2(() => $body.file).toEqual(undefined);
        expect2(() => $body.k).toEqual('v');
        expect2(() => $body.files.map((f: FileInfo) => [f.fieldname, f.originalname, f.mimetype, f.size])).toEqual([
            ['f1', 'one.bin', 'application/octet-stream', 3],
            ['f2', 'two.txt', 'text/plain', 3],
        ]);
        expect2(() => $body.files[1].buffer.toString()).toEqual('two');
    });

    //* broken multipart → 400.
    it('should fail B20 broken multipart with 400', async () => {
        const body = Buffer.from('--b\r\nContent-Disposition: form-data; name="a"\r\n\r\nvalue');
        const { res } = await run(post('multipart/form-data; boundary=b', b64(body), true));
        expect2(() => res.statusCode).toEqual(400);
        expect2(() => `${res.body}`.startsWith('@body is not valid multipart')).toEqual(true);
    });
});

describe('LambdaWEBHandler B20 response', () => {
    //* the `isBase64Encoded` flag by content type.
    it('should set B20 base64 flag only for non-textual types', async () => {
        const flagOf = (type?: string) => buildResponse(200, 'x', { contentType: type }).isBase64Encoded;
        expect2(() => flagOf()).toEqual(false);
        expect2(() => flagOf('application/json')).toEqual(false);
        expect2(() => flagOf('application/json; charset=utf-8')).toEqual(false);
        expect2(() => flagOf('text/html')).toEqual(false);
        expect2(() => flagOf('application/xml')).toEqual(false);
        expect2(() => flagOf('application/atom+xml')).toEqual(false);
        expect2(() => flagOf('application/javascript')).toEqual(false);
        expect2(() => flagOf('application/x-www-form-urlencoded')).toEqual(false);
        expect2(() => flagOf('image/png')).toEqual(true);
        expect2(() => flagOf('image/x-icon')).toEqual(true);
        expect2(() => flagOf('application/octet-stream')).toEqual(true);
        expect2(() => flagOf('application/pdf')).toEqual(true);
    });

    //* a `Buffer` body → base64 + true (content type as given, default octet-stream).
    it('should send B20 Buffer body as base64', async () => {
        const bytes = Buffer.from([0x00, 0x01, 0xfe, 0xff]);
        const r1 = buildResponse(200, bytes);
        expect2(() => r1, 'body,isBase64Encoded').toEqual({ body: bytes.toString('base64'), isBase64Encoded: true });
        expect2(() => r1.headers['Content-Type']).toEqual('application/octet-stream');
        const r2 = buildResponse(200, bytes, { contentType: 'image/png' });
        expect2(() => r2.headers['Content-Type']).toEqual('image/png');
        expect2(() => r2.isBase64Encoded).toEqual(true);
        //* a handler that returns a `Buffer`.
        const service = new LambdaWEBHandler(new LambdaHandler(), true);
        service.setHandler('hello', () => async () => bytes);
        const event = eventOf({ resource: '/hello/{id}', path: '/hello/a', pathParameters: { id: 'a' } });
        const res = await service.handle(event, await service.packContext(event, null));
        expect2(() => res, 'statusCode,body,isBase64Encoded').toEqual({
            statusCode: 200,
            body: bytes.toString('base64'),
            isBase64Encoded: true,
        });
    });
});
