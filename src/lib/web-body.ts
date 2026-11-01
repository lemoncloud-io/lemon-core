/**
 * `web-body.ts`
 * - helpers of an API Gateway (REST v1) web event: the path parameters (`{proxy+}`, `{cmd+}`),
 *   the base64 request body and the textual content types.
 * - used by `cores/protocol/protocol-service.ts` (web transformer) and `cores/lambda/lambda-web-handler.ts`.
 * - NOTE: internal only. do not export from `lib/index.ts` or any other barrel.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B20: `{proxy+}` and binary bodies).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { boundaryOf, parseMultipart, MultipartBody } from './multipart';

/**
 * type: `WebPath`
 * - the protocol path `/{type}/{id}/{cmd}` (`cmd` may hold `/`).
 */
export interface WebPath {
    type?: string;
    id?: string;
    cmd?: string;
}

/**
 * v5 B20: true if the content type is textual (the body is utf8 text, no base64 in the response).
 * - `text/*`, `application/json`, `*+json`, `application/xml`, `*+xml`, `application/javascript`,
 *   `application/x-www-form-urlencoded` (parameters like `; charset=utf-8` are ignored).
 */
export const isTextualType = (contentType: string): boolean => {
    const mime = `${contentType ?? ''}`.split(';')[0].trim().toLowerCase();
    if (!mime) return false;
    if (mime.startsWith('text/')) return true;
    if (mime.endsWith('+json') || mime.endsWith('+xml')) return true;
    return [
        'application/json',
        'application/xml',
        'application/javascript',
        'application/x-www-form-urlencoded',
    ].includes(mime);
};

/**
 * v5 B20: the protocol path of the API Gateway `pathParameters`.
 * - `{proxy+}` without `id` → `id` = 1st segment, `cmd` = the rest joined with `/` (empty → undefined).
 * - `{proxy+}` with `id` but no `cmd` (ex: `/{type}/{id}/{proxy+}`) → `cmd` = the whole proxy.
 * - `{cmd+}` (greedy `cmd`) is kept as is (it may hold `/`).
 * - values are used as delivered: API Gateway gives them percent-decoded, so no second decode here.
 * - no `proxy` → the same `{ type, id, cmd }` as before.
 */
export const asWebPath = (pathParameters: { [key: string]: string } | null | undefined): WebPath => {
    const $path: { [key: string]: string } = pathParameters || {};
    const { type, id, cmd, proxy } = $path;
    if (proxy === undefined || proxy === null) return { type, id, cmd };
    //* v5 B20: map the greedy `proxy` only to the slots that are not given.
    const text = `${proxy}`;
    if (id === undefined || id === null) {
        const [first, ...rest] = text.split('/');
        const $cmd = cmd !== undefined && cmd !== null ? cmd : rest.join('/') || undefined;
        return { type, id: first || undefined, cmd: $cmd };
    }
    if (cmd === undefined || cmd === null) return { type, id, cmd: text || undefined };
    return { type, id, cmd };
};

/**
 * v5 B20: decode a base64 body (`isBase64Encoded: true`) by the content type.
 * - textual → utf8 string (then parsed as before: json, form …).
 * - `multipart/form-data` → `{ ...fields, file?, files? }` (throws `@body … multipart` if not valid).
 * - any other type → `Buffer`.
 *
 * @param body          the base64 text.
 * @param contentType   the raw `content-type` header (the case of `boundary` is kept).
 */
export const decodeBase64Body = (body: string, contentType: string): string | Buffer | MultipartBody => {
    const buffer = Buffer.from(`${body ?? ''}`, 'base64');
    if (isTextualType(contentType)) return buffer.toString('utf8');
    const mime = `${contentType ?? ''}`.split(';')[0].trim().toLowerCase();
    if (mime === 'multipart/form-data') {
        try {
            return parseMultipart(buffer, boundaryOf(contentType));
        } catch (e) {
            //* `@` prefix → `400` by the web failure rules.
            throw new Error(`@body is not valid multipart - ${e?.message ?? e}`);
        }
    }
    return buffer;
};

/**
 * v5 B20: size of a body for a log line (a `Buffer` by its length, no JSON of the bytes).
 */
export const bodyLength = (body: any): number => {
    if (body === undefined || body === null) return -1;
    if (Buffer.isBuffer(body)) return body.length;
    if (typeof body === 'string') return body.length;
    //* a multipart body: count the file bytes, and JSON of the rest.
    const { file, files, ...rest } = body as MultipartBody;
    const bytes = (Array.isArray(files) ? files : file ? [file] : []).reduce((n, f) => n + (f?.size ?? 0), 0);
    try {
        return JSON.stringify(rest).length + bytes;
    } catch (e) {
        return bytes;
    }
};
