/**
 * `tools/local-gateway/app.ts`
 * - v5 B21: a tiny local app (no `express`): a node request listener `app(req, res)` with local-only extension
 *   routes (`app.get/post/put/patch/delete/all`, `app.use`) checked in order before the gateway fallback.
 * - not a web framework: only what local extension routes (e.g. `POST /echo`) need.
 * - internal module (not exported from the root).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B21).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { IncomingMessage, ServerResponse, STATUS_CODES } from 'http';
import { PayloadTooLargeError, readRawBody } from './event';
import { errorReply, sendReply } from './response';

//* v5 B21: the request seen by an extension route (node `IncomingMessage` + a few fields).
export interface LocalAppRequest extends IncomingMessage {
    /** path parameters of `:name` segments (decoded) */
    params: { [k: string]: string };
    /** query string as a single-value map (the last value wins, like `queryStringParameters`) */
    query: { [k: string]: string };
    /** parsed body: JSON → value, form → map, `text/*` → string, other → Buffer, empty or invalid JSON → undefined */
    body: any;
    /** raw body bytes (also reused by the gateway, so they are never read twice) */
    rawBody: Buffer;
}

//* v5 B21: the response helpers for an extension route (node `ServerResponse` + a few helpers).
export interface LocalAppResponse extends ServerResponse {
    status(code: number): LocalAppResponse;
    set(name: string | { [k: string]: any }, value?: any): LocalAppResponse;
    header(name: string | { [k: string]: any }, value?: any): LocalAppResponse;
    json(body: any): LocalAppResponse;
    send(body?: any): LocalAppResponse;
    sendStatus(code: number): LocalAppResponse;
}

//* v5 B21: an extension handler (`next()` → the next layer, `next(err)` → 500).
export type LocalAppHandler = (
    req: LocalAppRequest | any,
    res: LocalAppResponse | any,
    next: (err?: any) => void,
) => any;

//* v5 B21: the fallback (the local API Gateway) gets the plain node objects.
export type LocalAppFallback = (req: IncomingMessage, res: ServerResponse) => any;

//* v5 B21: the callable app (a node request listener) with the route methods.
export interface LocalApp {
    (req: IncomingMessage, res: ServerResponse): void;
    get(path: string, ...handlers: LocalAppHandler[]): LocalApp;
    post(path: string, ...handlers: LocalAppHandler[]): LocalApp;
    put(path: string, ...handlers: LocalAppHandler[]): LocalApp;
    patch(path: string, ...handlers: LocalAppHandler[]): LocalApp;
    delete(path: string, ...handlers: LocalAppHandler[]): LocalApp;
    all(path: string, ...handlers: LocalAppHandler[]): LocalApp;
    use(pathOrHandler: string | LocalAppHandler, ...handlers: LocalAppHandler[]): LocalApp;
}

//* v5 B21: options of the app.
export interface LocalAppOptions {
    /** (optional) error logger of a failed extension handler (default `console.error`) */
    onError?: (error: any) => void;
}

//* v5 B21: one registered layer (method `*` = any; `prefix` = `use()` match).
interface Layer {
    method: string;
    keys: string[];
    regex: RegExp;
    handler: LocalAppHandler;
}

//* v5 B21: compile a path (`/a/:id`) to a regex (exact, or prefix for `use`); one trailing `/` is allowed.
const compilePath = (path: string, prefix: boolean): { keys: string[]; regex: RegExp } => {
    const keys: string[] = [];
    const clean = `/${`${path || '/'}`.replace(/^\/+|\/+$/g, '')}`;
    const body = clean
        .split('/')
        .map(seg => {
            if (seg.startsWith(':') && seg.length > 1) {
                keys.push(seg.substring(1));
                return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/');
    if (clean === '/') return { keys, regex: prefix ? /^\// : /^\/$/ };
    return { keys, regex: new RegExp(prefix ? `^${body}(?:/|$)` : `^${body}/?$`) };
};

//* v5 B21: decode a path segment (a bad escape stays as is).
const decodeSeg = (s: string): string => {
    try {
        return decodeURIComponent(s);
    } catch (e) {
        return s;
    }
};

//* v5 B21: a `URLSearchParams` text as a single-value map (the last value wins).
const singleMap = (text: string): { [k: string]: string } => {
    const map: { [k: string]: string } = {};
    new URLSearchParams(text).forEach((v, k) => (map[k] = v));
    return map;
};

//* v5 B21: parse raw bytes by `Content-Type` (empty → undefined).
export const parseBody = (raw: Buffer, contentType: string): any => {
    if (!raw || raw.length === 0) return undefined;
    const type = `${contentType || ''}`.toLowerCase();
    if (/^application\/([\w.+-]+\+)?json/.test(type)) {
        try {
            return JSON.parse(raw.toString('utf8'));
        } catch (e) {
            return undefined;
        }
    }
    if (type.startsWith('application/x-www-form-urlencoded')) return singleMap(raw.toString('utf8'));
    if (type.startsWith('text/')) return raw.toString('utf8');
    return raw;
};

//* v5 B21: add the response helpers to a node response (once).
const withHelpers = (res: any): LocalAppResponse => {
    if (res.__localApp) return res;
    res.__localApp = true;
    //* write bytes with a default content type (no body for `HEAD` is handled by node).
    const write = (bytes: Buffer, type: string, code?: number) => {
        if (code !== undefined) res.statusCode = code;
        if (!res.getHeader('content-type')) res.setHeader('Content-Type', type);
        res.setHeader('Content-Length', `${bytes.length}`);
        res.end(bytes);
        return res;
    };
    res.status = (code: number) => ((res.statusCode = code), res);
    res.set = (name: any, value?: any) => {
        if (name && typeof name === 'object') Object.entries(name).forEach(([k, v]) => res.setHeader(k, v as any));
        else res.setHeader(name, Array.isArray(value) ? value.map(String) : `${value}`);
        return res;
    };
    res.header = res.set;
    res.json = (body: any) => write(Buffer.from(JSON.stringify(body) ?? '', 'utf8'), 'application/json; charset=utf-8');
    res.send = (body?: any) => {
        if (body === undefined || body === null) return write(Buffer.alloc(0), 'text/html; charset=utf-8');
        if (Buffer.isBuffer(body)) return write(body, 'application/octet-stream');
        if (typeof body === 'string') return write(Buffer.from(body, 'utf8'), 'text/html; charset=utf-8');
        return res.json(body);
    };
    res.sendStatus = (code: number) =>
        write(Buffer.from(STATUS_CODES[code] || `${code}`, 'utf8'), 'text/plain; charset=utf-8', code);
    return res;
};

/**
 * v5 B21: create the local app.
 * - extension routes are checked in registration order; a request that matches none goes to `fallback` untouched
 *   (the stream is not read, so the gateway reads the raw bytes itself).
 * - when a layer matches, the body is read once (`req.rawBody`, 10 MB → 413) and parsed into `req.body`.
 * - a throwing (or rejecting) handler, or `next(err)` → `500 {"message":"Internal server error"}` (never hangs).
 *
 * @param fallback - the handler of the rest (the local API Gateway)
 */
export const createLocalApp = (fallback: LocalAppFallback, options?: LocalAppOptions): LocalApp => {
    const layers: Layer[] = [];
    const onError = options?.onError ?? ((e: any) => console.error('! local-app.err =', e));

    //* the layers that match a request (in order) with their params.
    const matchesOf = (method: string, pathname: string) =>
        layers
            .map(layer => {
                const ok =
                    layer.method === '*' || layer.method === method || (layer.method === 'GET' && method === 'HEAD');
                const m = ok ? layer.regex.exec(pathname) : null;
                if (!m) return null;
                const params: { [k: string]: string } = {};
                layer.keys.forEach((k, i) => (params[k] = decodeSeg(m[i + 1])));
                return { layer, params };
            })
            .filter(x => !!x);

    //* answer 500 (or just end, when the response already started).
    const fail = (res: ServerResponse, e: any): void => {
        onError(e);
        if (res.headersSent) return void (!res.writableEnded && res.end());
        sendReply(res, errorReply(500, 'Internal server error'));
    };

    //* the node request listener.
    const app: any = (req: IncomingMessage, res: ServerResponse): void => {
        const method = `${req.method || 'GET'}`.toUpperCase();
        const url = `${req.url || '/'}`;
        const q = url.indexOf('?');
        const pathname = q >= 0 ? url.substring(0, q) : url;
        const search = q >= 0 ? url.substring(q + 1) : '';
        const matched = matchesOf(method, pathname || '/');
        if (!matched.length) return void fallback(req, res);
        const $req: any = req;
        const $res = withHelpers(res);
        //* run the matched layers in order, then the fallback (the body is already in `rawBody`).
        const run = (i: number): void => {
            let called = false;
            const next = (err?: any): void => {
                if (called) return;
                called = true;
                if (err) return fail(res, err);
                run(i + 1);
            };
            if (i >= matched.length) return void fallback(req, res);
            $req.params = matched[i].params;
            try {
                const ret = matched[i].layer.handler($req, $res, next);
                if (ret && typeof ret.then === 'function') ret.then(undefined, (e: any) => fail(res, e));
            } catch (e) {
                fail(res, e);
            }
        };
        //* read the body once (kept in `rawBody` for the gateway too).
        const ready: Promise<Buffer> = Buffer.isBuffer($req.rawBody) ? Promise.resolve($req.rawBody) : readRawBody(req);
        ready.then(
            (raw: Buffer): void => {
                $req.rawBody = raw;
                $req.query = singleMap(search);
                $req.body = parseBody(raw, `${req.headers['content-type'] || ''}`);
                run(0);
            },
            (e: any): void => {
                if (e instanceof PayloadTooLargeError) return sendReply(res, errorReply(413, 'Request Too Long'));
                fail(res, e);
            },
        );
    };

    //* register a route (exact path) or a `use` layer (path prefix).
    const add = (method: string, prefix: boolean, path: string, handlers: LocalAppHandler[]) => {
        const { keys, regex } = compilePath(path, prefix);
        handlers.forEach(handler => {
            if (typeof handler !== 'function') throw new Error(`@handler (function) is required - ${method} ${path}`);
            layers.push({ method, keys, regex, handler });
        });
        return app;
    };
    app.get = (path: string, ...h: LocalAppHandler[]) => add('GET', false, path, h);
    app.post = (path: string, ...h: LocalAppHandler[]) => add('POST', false, path, h);
    app.put = (path: string, ...h: LocalAppHandler[]) => add('PUT', false, path, h);
    app.patch = (path: string, ...h: LocalAppHandler[]) => add('PATCH', false, path, h);
    app.delete = (path: string, ...h: LocalAppHandler[]) => add('DELETE', false, path, h);
    app.all = (path: string, ...h: LocalAppHandler[]) => add('*', false, path, h);
    app.use = (pathOrHandler: string | LocalAppHandler, ...h: LocalAppHandler[]) =>
        typeof pathOrHandler === 'function'
            ? add('*', true, '/', [pathOrHandler, ...h])
            : add('*', true, pathOrHandler, h);
    return app as LocalApp;
};
