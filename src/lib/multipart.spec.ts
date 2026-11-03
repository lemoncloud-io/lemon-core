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
import { asWebPath, decodeBase64Body, isTextualType, bodyLength } from './web-body';

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
