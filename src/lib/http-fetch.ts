/**
 * `http-fetch.ts`
 * - internal transport for the http proxy factories (`createSigV4Proxy`, `createHttpWebProxy`, `$X.createHttpSearchProxy`).
 * - uses the Node built-in `fetch`, and keeps the contract of the former `request` based code (v4).
 * - NOTE: internal only. do not export from `lib/index.ts` or any other barrel.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-27 initial version (v5 B2-a: `request` -> `fetch`)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { GETERR } from '../common/test-helper';
import { asLemonError } from '../common/lemon-error';

//* v5 B5: default timeout of one request (ms) — under API Gateway 29 s and the 30 s Lambda timeout (SPEC § 6.6).
export const DEFAULT_FETCH_TIMEOUT = 25000;

/** one request to send (the payload is serialized already, see `toPayload()`) */
export interface HttpFetchRequest {
    /** http method (GET, PUT, POST, ...) */
    method: string;
    /** full url with query-string */
    url: string;
    /** headers to send (`undefined`/`null` values are skipped) */
    headers?: { [key: string]: any };
    /** serialized body sent as-is (for SigV4 it must be the exact signed string) */
    payload?: string;
    /** json mode, same meaning as `request` option `json:true` */
    json: boolean;
    /** (optional) timeout in ms (v5 default `DEFAULT_FETCH_TIMEOUT` = 25000) */
    timeout?: number;
}

/** optional log hooks, so each factory keeps its own namespace and verbosity */
export interface HttpFetchLogger {
    /** normal log */
    log?: (...args: any[]) => void;
    /** error log */
    err?: (...args: any[]) => void;
}

/** json mode rule of the factories: a string body goes plain, anything else as json */
export const isJsonBody = ($body: any): boolean => typeof $body !== 'string';

/** serialize the body once: `null`/`undefined` → no body, json → `JSON.stringify`, string → as-is */
export const toPayload = ($body: any, json: boolean): string | undefined => {
    if ($body === null || $body === undefined) return undefined;
    return json ? JSON.stringify($body) : `${$body}`;
};

/** turn a `fetch` failure into an Error whose message starts with the errno (ex: `ECONNREFUSED ...`) */
export const asFetchError = (e: any, timeout?: number): Error => {
    //* v5: `AbortSignal.timeout` rejects with `TimeoutError` (no `cause`) → errno-style `ETIMEDOUT timeout ...`.
    if (e?.name === 'TimeoutError') return new Error(`ETIMEDOUT timeout after ${timeout ?? DEFAULT_FETCH_TIMEOUT} ms`);
    const cause = e?.cause;
    return new Error(`${cause?.code ?? 'FETCH_FAILED'} ${cause?.message ?? e?.message}`);
};

/** parse response text like `request` did: json → try `JSON.parse` on any text (empty → `undefined`), else the text */
export const parseResponseText = (text: string, json: boolean): any => {
    if (!json) return text;
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
};

/** build fetch headers: string values, last one wins case-insensitively, json defaults added if absent */
export const buildHeaders = (req: HttpFetchRequest): Headers => {
    const headers = new Headers();
    // copy given headers, skipping empty values.
    Object.entries(req.headers ?? {}).forEach(([key, val]) => {
        if (val !== undefined && val !== null) headers.set(key, `${val}`);
    });
    // json mode defaults, same as `request`: accept always, content-type only with a body.
    if (req.json && !headers.has('accept')) headers.set('accept', 'application/json');
    if (req.json && req.payload !== undefined && !headers.has('content-type'))
        headers.set('content-type', 'application/json');
    return headers;
};

/** the raw response: status and the parsed body (`statusMessage` is `res.statusText`) */
export interface HttpFetchResponse {
    /** http status code */
    statusCode: number;
    /** http status text */
    statusMessage: string;
    /** body parsed by `parseResponseText()` */
    body: any;
}

/** send one request with `fetch`, and read the body. network errors (and timeout) are rethrown by `asFetchError()` */
export const sendRequest = async (req: HttpFetchRequest): Promise<HttpFetchResponse> => {
    const method = `${req.method || 'GET'}`.toUpperCase();
    // `fetch` cannot send a body with GET/HEAD (SigV4 also signs an empty body for GET).
    const body = method === 'GET' || method === 'HEAD' ? undefined : req.payload;
    //* v5: every request has a timeout (default 25 s, per-request `timeout`).
    const timeout = req.timeout ?? DEFAULT_FETCH_TIMEOUT;
    try {
        const signal = AbortSignal.timeout(timeout);
        const res = await fetch(req.url, { method, headers: buildHeaders(req), body, signal });
        const text = await res.text();
        return { statusCode: res.status, statusMessage: res.statusText, body: parseResponseText(text, req.json) };
    } catch (e) {
        throw asFetchError(e, timeout);
    }
};

/** re-parse a string body that looks like a json object or array (kept from the v4 code) */
export const reparseBody = (body: any, logger?: HttpFetchLogger): any => {
    try {
        if (body && typeof body == 'string' && body.startsWith('{') && body.endsWith('}')) return JSON.parse(body);
        if (body && typeof body == 'string' && body.startsWith('[') && body.endsWith(']')) return JSON.parse(body);
    } catch (e) {
        logger?.err?.('!WARN! parse(body) =', e instanceof Error ? e : GETERR(e));
    }
    return body;
};

/** turn a non-success response into the v4 error message (400·404 and other formats) — v5: a `LemonError` with the peer status */
export const asStatusError = (res: HttpFetchResponse, logger?: HttpFetchLogger): Error => {
    const { statusCode, statusMessage, body } = res;
    const msg = body ? GETERR(body) : `${statusMessage || ''}`;
    // 400·404: `<code> <TITLE> - <msg>`, unless the message is already `404 NOT FOUND ...`.
    if (statusCode === 400 || statusCode === 404) {
        const title = `${(statusCode == 404 ? '' : statusMessage) || 'NOT FOUND'}`.toUpperCase();
        return asLemonError(
            statusCode,
            msg.startsWith('404 NOT FOUND') ? msg : `${statusCode} ${title} - ${msg}`,
            title,
        );
    }
    statusMessage && logger?.log?.(`> statusMessage[${statusCode}] =`, statusMessage);
    body && logger?.log?.(`> body[${statusCode}] =`, GETERR(body));
    //* v5: the message string is unchanged, the status is typed.
    return asLemonError(
        statusCode,
        `${statusCode} ${statusMessage || 'FAILURE'} - ${msg}`,
        `${statusMessage || 'FAILURE'}`,
    );
};

/** v5: any 2xx is a success (B5 § 6.6) */
export const isSuccessStatus = (status: number): boolean => status >= 200 && status < 300;

/** send a request and resolve the body: v5 success on any 2xx (204, or another 2xx with no body → `null`), other status codes reject */
export const fetchProxyBody = async <T = any>(req: HttpFetchRequest, logger?: HttpFetchLogger): Promise<T> => {
    const res = await sendRequest(req).catch((e: Error) => {
        logger?.err?.('>>>>> requested! err=', e);
        throw e;
    });
    if (!isSuccessStatus(res.statusCode)) throw asStatusError(res, logger);
    //* v5: a 2xx other than 200·201 with no body (ex: 204) → `null` (200·201 keep the v4 empty-body result).
    const noBody = res.body === undefined || res.body === '';
    if (noBody && res.statusCode !== 200 && res.statusCode !== 201) return null;
    return reparseBody(res.body, logger);
};
