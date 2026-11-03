/**
 * `multipart.spec.ts`
 * - v5 B20: unit test of the in-memory `multipart/form-data` parser and the web body helpers.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B20).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it } from 'vitest';
import { expect2 } from '../common/test-helper';
import { boundaryOf, parseHeaderValue, parseMultipart } from './multipart';
import { asWebPath, decodeBase64Body, decodePath, decodePiece, isTextualType, bodyLength } from './web-body';

//* v5 B20: join lines with CRLF into a Buffer.
const crlf = (...lines: string[]) => Buffer.from(lines.join('\r\n'));

describe('multipart B20', () => {
    //* header values with quoted params.
    it('should parse B20 header values', () => {
        expect2(() => parseHeaderValue('form-data; name="a"; filename="b;c.txt"')).toEqual({
            value: 'form-data',
            params: { name: 'a', filename: 'b;c.txt' },
        });
        expect2(() => parseHeaderValue('form-data; NAME=x ; filename="q\\"uote\\\\d" ')).toEqual({
            value: 'form-data',
            params: { name: 'x', filename: 'q"uote\\d' },
        });
        //* a `\` not before `"` or `\` is kept (as browsers send windows paths).
        expect2(() => parseHeaderValue('form-data; filename="C:\\a.txt"').params.filename).toEqual('C:\\a.txt');
        expect2(() => parseHeaderValue('text/plain').params).toEqual({});
    });

    //* boundary of the content type (quoted or not, case kept).
    it('should read B20 boundary', () => {
        expect2(() => boundaryOf('multipart/form-data; boundary=AbC')).toEqual('AbC');
        expect2(() => boundaryOf('multipart/form-data; charset=utf-8; boundary="a b:c"')).toEqual('a b:c');
        expect2(() => boundaryOf('multipart/form-data')).toEqual('.boundary is required - multipart');
    });

    //* preamble and epilogue are ignored.
    it('should ignore B20 preamble and epilogue', () => {
        const body = crlf(
            'this is the preamble',
            '--XX',
            'Content-Disposition: form-data; name="a"',
            '',
            '1',
            '--XX',
            'Content-Disposition: form-data; name="a"',
            '',
            '2',
            '--XX--',
            'this is the epilogue',
        );
        expect2(() => parseMultipart(body, 'XX')).toEqual({ a: ['1', '2'] });
    });

    //* the quoted boundary from the content type parses the body.
    it('should parse B20 with quoted boundary', () => {
        const boundary = boundaryOf('multipart/form-data; boundary="q b"');
        const body = crlf('--q b', 'Content-Disposition: form-data; name="k"', '', 'v', '--q b--', '');
        expect2(() => parseMultipart(body, boundary)).toEqual({ k: 'v' });
    });

    //* missing final boundary → error.
    it('should fail B20 without final boundary', () => {
        const body = crlf('--B', 'Content-Disposition: form-data; name="a"', '', 'no end');
        expect2(() => parseMultipart(body, 'B')).toEqual('missing final boundary - multipart');
        expect2(() => parseMultipart(crlf('nothing here'), 'B')).toEqual('no boundary found - multipart');
        expect2(() => parseMultipart(null, 'B')).toEqual('@body (Buffer) is required - multipart');
        //* the web helper wraps the error as `@body …` (400).
        const b64 = body.toString('base64');
        expect2(() => decodeBase64Body(b64, 'multipart/form-data; boundary=B')).toEqual(
            '@body is not valid multipart - missing final boundary - multipart',
        );
    });

    //* file bytes with CRLF, `--` and 0x00 are kept; empty file; part without name is skipped.
    it('should keep B20 file bytes exactly', () => {
        const bytes = Buffer.from([0x0d, 0x0a, 0x2d, 0x2d, 0x43, 0x00, 0x0d, 0x0a]); // `\r\n--C\0\r\n` (not the boundary)
        const body = Buffer.concat([
            crlf('--B', 'Content-Disposition: form-data; name="f"; filename="x.bin"', 'Content-Type: app/x', '', ''),
            bytes,
            crlf('', '--B', 'Content-Disposition: form-data; name="e"; filename=""', '', ''),
            crlf('', '--B', 'Content-Disposition: attachment', '', 'skip', '--B--'),
        ]);
        const res = parseMultipart(body, 'B');
        expect2(() => res.files.length).toEqual(2);
        expect2(() => res.file).toEqual(undefined);
        expect2(() => res.files[0].buffer.equals(bytes)).toEqual(true);
        expect2(() => res.files[0], 'mimetype,size').toEqual({ mimetype: 'app/x', size: bytes.length });
        expect2(() => res.files[1], 'originalname,size').toEqual({ originalname: '', size: 0 });
        expect2(() => Object.keys(res)).toEqual(['files']);
    });

    //* textual types.
    it('should classify B20 textual types', () => {
        const yes = ['text/plain', 'TEXT/HTML; charset=utf-8', 'application/json', 'application/ld+json'];
        const yes2 = [
            'application/xml',
            'image/svg+xml',
            'application/javascript',
            'application/x-www-form-urlencoded',
        ];
        const no = ['', 'image/png', 'application/octet-stream', 'multipart/form-data; boundary=x', 'application/pdf'];
        expect2(() => [...yes, ...yes2].map(isTextualType)).toEqual([...yes, ...yes2].map(() => true));
        expect2(() => no.map(isTextualType)).toEqual(no.map(() => false));
    });

    //* the path parameters.
    it('should map B20 web path', () => {
        expect2(() => asWebPath(null)).toEqual({ type: undefined, id: undefined, cmd: undefined });
        expect2(() => asWebPath({ id: 'a', cmd: 'b' })).toEqual({ type: undefined, id: 'a', cmd: 'b' });
        expect2(() => asWebPath({ proxy: 'a/b/c' })).toEqual({ type: undefined, id: 'a', cmd: 'b/c' });
        expect2(() => asWebPath({ proxy: 'a/' })).toEqual({ type: undefined, id: 'a', cmd: undefined });
        expect2(() => asWebPath({ proxy: '' })).toEqual({ type: undefined, id: undefined, cmd: undefined });
        expect2(() => asWebPath({ type: 't', id: 'i', proxy: 'x/y' })).toEqual({ type: 't', id: 'i', cmd: 'x/y' });
        expect2(() => asWebPath({ id: 'i', cmd: 'c', proxy: 'x' })).toEqual({ type: undefined, id: 'i', cmd: 'c' });
    });

    //* v5 B20: API Gateway delivers path values raw (measured 2026-11-04) → split on `/`, then decode each piece once.
    it('should decode B20 web path pieces once', () => {
        const p = (proxy: string) => asWebPath({ proxy });
        const table: [string, string, string][] = [
            ['a%20b/c', 'a b', 'c'],
            ['a%2Fb/c', 'a/b', 'c'], // an encoded `/` stays in one piece
            ['%ED%95%9C%EA%B8%80/x', '한글', 'x'],
            ['a+b/c', 'a+b', 'c'], // `+` is literal in a path
            ['%2523/x', '%23', 'x'], // decoded once
            ['a%25b/c', 'a%b', 'c'],
            ['%zz/x', '%zz', 'x'], // a bad escape stays raw
            ['a//b', 'a', '/b'], // an empty segment is kept
            ['x/c%2Fd/e%20f', 'x', 'c/d/e f'],
        ];
        expect2(() => table.map(([proxy]) => [proxy, p(proxy).id, p(proxy).cmd])).toEqual(table);
        //* greedy `{id+}` / `{cmd+}` → per segment, re-joined with `/`.
        expect2(() => asWebPath({ id: 'a%2Fb/c.png' })).toEqual({ type: undefined, id: 'a/b/c.png', cmd: undefined });
        expect2(() => asWebPath({ id: 'i', cmd: 'c%2Fd' })).toEqual({ type: undefined, id: 'i', cmd: 'c/d' });
        expect2(() => asWebPath({ id: 'i', cmd: 'x%20y/%zz' })).toEqual({ type: undefined, id: 'i', cmd: 'x y/%zz' });
        //* plain `{id}` / `{cmd}`.
        expect2(() => asWebPath({ id: 'a%20b', cmd: 'c%2Fd' })).toEqual({ type: undefined, id: 'a b', cmd: 'c/d' });
        //* `{id}/{proxy+}` → the whole proxy as `cmd`, decoded per piece.
        expect2(() => asWebPath({ type: 't', id: 'a%20b', proxy: 'x%2Fy/z' })).toEqual({
            type: 't',
            id: 'a b',
            cmd: 'x/y/z',
        });
        //* `undefined`/empty rules are kept.
        expect2(() => asWebPath({ id: '', cmd: '' })).toEqual({ type: undefined, id: '', cmd: '' });
        expect2(() => asWebPath({ proxy: 'a%20b/' })).toEqual({ type: undefined, id: 'a b', cmd: undefined });
        //* the helpers.
        expect2(() => [decodePiece('a%20b'), decodePiece('%E0%A4%A'), decodePiece('a+b')]).toEqual([
            'a b',
            '%E0%A4%A',
            'a+b',
        ]);
        expect2(() => decodePath('a%2Fb/%zz//c%20d')).toEqual('a/b/%zz//c d');
    });

    //* body length for logs.
    it('should count B20 body length', () => {
        expect2(() => bodyLength(null)).toEqual(-1);
        expect2(() => bodyLength(Buffer.alloc(5))).toEqual(5);
        expect2(() => bodyLength('abc')).toEqual(3);
        expect2(() => bodyLength({ a: 1 })).toEqual(7);
        const file: any = { size: 10 };
        expect2(() => bodyLength({ a: 1, file, files: [file] })).toEqual(17);
    });
});
