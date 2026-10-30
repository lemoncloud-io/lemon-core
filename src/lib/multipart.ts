/**
 * `multipart.ts`
 * - small, dependency-free `multipart/form-data` parser for a request body that is already in memory (a `Buffer`).
 * - result: `{ ...fields, file?: FileInfo, files?: FileInfo[] }` — the multer-like shape, but with `buffer` (no disk `path`).
 * - used by the web transformer (`cores/protocol/protocol-service.ts`) when API Gateway gives a base64 body.
 * - NOTE: internal only. do not export from `lib/index.ts` or any other barrel.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B20: binary request body).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */

/**
 * type: `FileInfo`
 * - one uploaded file (multer-like, `buffer` instead of `path`).
 */
export interface FileInfo {
    /** name of the form field */
    fieldname: string;
    /** file name given by the client (`filename` of `Content-Disposition`) */
    originalname: string;
    /** transfer encoding (always `7bit`, as multer) */
    encoding: '7bit';
    /** content type of the part (default `application/octet-stream`) */
    mimetype: string;
    /** size in bytes */
    size: number;
    /** the file bytes */
    buffer: Buffer;
}

/**
 * type: `MultipartBody`
 * - text fields by name (a repeated name → array), plus `file` (exactly one file) and `files` (one or more).
 */
export interface MultipartBody {
    [key: string]: any;
    file?: FileInfo;
    files?: FileInfo[];
}

/**
 * type: `HeaderValue`
 * - a header value split into the main value and its `; key=value` parameters (keys in lower case).
 */
export interface HeaderValue {
    value: string;
    params: { [key: string]: string };
}

//* v5 B20: CRLF and the `--` marker as bytes.
const CRLF = Buffer.from('\r\n');
const DASH = Buffer.from('--');

/**
 * v5 B20: parse a header value like `form-data; name="a"; filename="b.txt"`.
 * - quoted values may hold `;` and `\"`. parameter names are lower case.
 */
export const parseHeaderValue = (text: string): HeaderValue => {
    const src = `${text ?? ''}`;
    const params: { [key: string]: string } = {};
    let i = src.indexOf(';');
    const value = (i < 0 ? src : src.substring(0, i)).trim();
    //* v5 B20: walk the parameters one by one (quoted strings are read char by char).
    while (i >= 0 && i < src.length) {
        i++; // skip `;`
        const eq = src.indexOf('=', i);
        if (eq < 0) break;
        const name = src.substring(i, eq).trim().toLowerCase();
        let j = eq + 1;
        while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++;
        let val = '';
        if (src[j] === '"') {
            //* quoted string: `\"` and `\\` are escapes, any other `\` is kept (as browsers send it).
            j++;
            while (j < src.length && src[j] !== '"') {
                if (src[j] === '\\' && (src[j + 1] === '"' || src[j + 1] === '\\')) j++;
                val += src[j++];
            }
            const next = src.indexOf(';', j);
            i = next;
        } else {
            //* token: up to the next `;`.
            const next = src.indexOf(';', j);
            val = (next < 0 ? src.substring(j) : src.substring(j, next)).trim();
            i = next;
        }
        if (name) params[name] = val;
    }
    return { value, params };
};

/**
 * v5 B20: the boundary of a `multipart/*` content type (quoted or not).
 * - throws if there is none.
 */
export const boundaryOf = (contentType: string): string => {
    const { params } = parseHeaderValue(contentType);
    const boundary = params['boundary'] || '';
    if (!boundary) throw new Error(`.boundary is required - multipart`);
    return boundary;
};

/**
 * v5 B20: parse the headers block of one part (`Name: value` lines, names in lower case).
 */
const parsePartHeaders = (text: string): { [key: string]: string } =>
    text.split('\r\n').reduce<{ [key: string]: string }>((M, line) => {
        const k = line.indexOf(':');
        if (k > 0) M[line.substring(0, k).trim().toLowerCase()] = line.substring(k + 1).trim();
        return M;
    }, {});

/**
 * v5 B20: parse a `multipart/form-data` body.
 * - the preamble (before the first boundary) and the epilogue (after the closing boundary) are ignored.
 * - a missing closing boundary throws. a part without `Content-Disposition: form-data; name=…` is skipped.
 * - a part with `filename` is a file (`buffer` is a copy of the bytes), else a text field (utf8).
 *
 * @param body      the whole body bytes.
 * @param boundary  the boundary (from `boundaryOf()`).
 */
export const parseMultipart = (body: Buffer, boundary: string): MultipartBody => {
    if (!Buffer.isBuffer(body)) throw new Error(`@body (Buffer) is required - multipart`);
    if (!boundary) throw new Error(`@boundary (string) is required - multipart`);
    const dash = Buffer.from(`--${boundary}`);
    const delim = Buffer.concat([CRLF, dash]); // a boundary inside the body is always after CRLF.

    //* v5 B20: the first boundary is at the start, or after CRLF (end of the preamble).
    const atStart = body.subarray(0, dash.length).equals(dash);
    let pos = atStart ? 0 : body.indexOf(delim);
    if (pos < 0) throw new Error(`no boundary found - multipart`);
    if (!atStart) pos += CRLF.length; // skip the CRLF that ends the preamble.

    const fields: { [key: string]: any } = {};
    const files: FileInfo[] = [];
    //* v5 B20: read parts until the closing boundary (`--boundary--`).
    for (;;) {
        let at = pos + dash.length;
        if (body.subarray(at, at + 2).equals(DASH)) break; // closing boundary → done (epilogue ignored).
        //* skip the transport padding (spaces, tabs) and the CRLF after the boundary.
        while (body[at] === 0x20 || body[at] === 0x09) at++;
        if (!body.subarray(at, at + 2).equals(CRLF)) throw new Error(`invalid boundary line - multipart`);
        at += 2;
        const end = body.indexOf(delim, at);
        if (end < 0) throw new Error(`missing final boundary - multipart`);
        const part = body.subarray(at, end);

        //* split the part into headers and content (an empty headers block starts with CRLF).
        const sep = part.subarray(0, 2).equals(CRLF) ? 0 : part.indexOf('\r\n\r\n');
        if (sep < 0) throw new Error(`invalid part headers - multipart`);
        const head = parsePartHeaders(part.subarray(0, sep).toString('utf8'));
        const content = part.subarray(sep + (sep === 0 ? 2 : 4));
        const disposition = parseHeaderValue(head['content-disposition'] || '');
        const name = disposition.params['name'];

        //* keep only `form-data` parts with a name.
        if (disposition.value.toLowerCase() === 'form-data' && name !== undefined) {
            const filename = disposition.params['filename'];
            if (filename !== undefined) {
                //* a file part: copy the bytes (no view on the whole body).
                files.push({
                    fieldname: name,
                    originalname: filename,
                    encoding: '7bit',
                    mimetype: head['content-type'] || 'application/octet-stream',
                    size: content.length,
                    buffer: Buffer.from(content),
                });
            } else {
                //* a text field: a repeated name becomes an array.
                const text = content.toString('utf8');
                const prev = fields[name];
                fields[name] = prev === undefined ? text : Array.isArray(prev) ? [...prev, text] : [prev, text];
            }
        }
        pos = end + CRLF.length;
    }

    //* `file` only for exactly one file, `files` for one or more.
    const res: MultipartBody = { ...fields };
    if (files.length === 1) res.file = files[0];
    if (files.length >= 1) res.files = files;
    return res;
};
