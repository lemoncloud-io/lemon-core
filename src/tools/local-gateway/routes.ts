/**
 * `tools/local-gateway/routes.ts`
 * - v5 B20: the route table of the local API Gateway (REST v1) emulator, read from `serverless.yml`.
 * - internal module (not exported from the root).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B20-b).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

//* v5 B20: the CORS setting of one route (after normalizing `cors: true` and object shapes).
export interface GatewayCors {
    /** allowed origins (`*` = any) */
    origins: string[];
    /** allowed request headers */
    headers: string[];
    /** `Access-Control-Allow-Credentials: true` if set */
    allowCredentials: boolean;
    /** (optional) `Access-Control-Max-Age` in seconds */
    maxAge?: number;
}

//* v5 B20: one `http` event of a function.
export interface GatewayRoute {
    /** function name in `serverless.yml` (or `legacy`) */
    fn: string;
    /** upper-case method, or `ANY` */
    method: string;
    /** resource path like `/hello/{id}` (leading `/`, no trailing `/`) */
    resource: string;
    /** cors setting, or `null` when off */
    cors: GatewayCors | null;
}

//* v5 B20: the whole table (+ where it came from).
export interface GatewayRouteTable {
    /** `serverless` (from the file) or `legacy` (fallback) */
    source: 'serverless' | 'legacy';
    /** all routes */
    routes: GatewayRoute[];
    /** `provider.apiGateway.binaryMediaTypes` (+ option) */
    binaryMediaTypes: string[];
    /** (optional) one warning line when the fallback is used */
    warning?: string;
}

//* v5 B20: the default `Access-Control-Allow-Headers` of Serverless `cors: true` (same list as the B19 deploy contract).
export const DEFAULT_CORS_HEADERS = [
    'Content-Type',
    'X-Amz-Date',
    'Authorization',
    'X-Api-Key',
    'X-Amz-Security-Token',
    'X-Amz-User-Agent',
    'X-Amzn-Trace-Id',
];

//* v5 B20: CloudFormation short tags (`!Ref`, `!Sub`, …) are read as plain data (scalars stay strings).
const CFN_TAGS =
    'Ref,Sub,GetAtt,Join,Select,Split,If,Equals,Not,And,Or,FindInMap,ImportValue,Base64,Cidr,GetAZs,Condition,Transform';

//* v5 B20: a js-yaml schema that tolerates the CloudFormation tags (for the 3 node kinds).
const cfnSchema = (): any => {
    const Y: any = yaml;
    const kinds = ['scalar', 'sequence', 'mapping'];
    const types = CFN_TAGS.split(',').flatMap(tag =>
        kinds.map(kind => new Y.Type(`!${tag}`, { kind, construct: (data: any) => data })),
    );
    return Y.DEFAULT_SCHEMA.extend(types);
};

//* v5 B20: parse a yaml text with the tolerant schema (throws on a syntax error).
export const parseServerlessYaml = (text: string): any => (yaml as any).load(text, { schema: cfnSchema() });

//* v5 B20: value at a dotted path (`custom.cors`) of an object, or `undefined`.
const pick = (doc: any, dotted: string): any =>
    dotted.split('.').reduce((M: any, k: string) => (M && typeof M === 'object' ? M[k] : undefined), doc);

//* v5 B20: a literal fallback of `${…, <fallback>}` (`true`/`false`/number/quoted string).
const literalOf = (text: string): any => {
    const s = `${text ?? ''}`.trim();
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    const q = /^(['"])(.*)\1$/.exec(s);
    return q ? q[2] : s;
};

//* v5 B20: resolve a whole-value `${self:a.b, fallback}` against the document; other `${…}` stay strings.
export const resolveSelf = (value: any, doc: any, depth = 0): any => {
    if (typeof value !== 'string' || depth > 5) return value;
    const m = /^\$\{self:([^,}\s]+)\s*(?:,\s*(.+))?\}$/.exec(value.trim());
    if (!m) return value;
    const found = pick(doc, m[1]);
    if (found !== undefined) return resolveSelf(found, doc, depth + 1);
    return m[2] !== undefined ? literalOf(m[2]) : value;
};

//* v5 B20: normalize a resource path: leading `/`, no trailing `/`, no empty segments.
export const normalizePath = (p: string): string => {
    const segs = `${p ?? ''}`.split('/').filter(s => s.length > 0);
    return `/${segs.join('/')}`;
};

//* v5 B20: list of strings from a string or an array (`a,b` is split).
const listOf = (v: any): string[] =>
    (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
        .map((s: any) => `${s ?? ''}`.trim())
        .filter((s: string) => s.length > 0);

//* v5 B20: normalize a Serverless `cors` value (`true`, object, unresolved variable) → `GatewayCors | null`.
export const normalizeCors = (cors: any): GatewayCors | null => {
    if (cors === undefined || cors === null || cors === false) return null;
    //* an unresolved variable string (`${…}`) is taken as `cors: true` (Serverless resolves it to a truthy value).
    if (cors === true || typeof cors === 'string') {
        if (typeof cors === 'string' && cors.trim() === 'false') return null;
        return { origins: ['*'], headers: [...DEFAULT_CORS_HEADERS], allowCredentials: false };
    }
    if (typeof cors !== 'object') return null;
    const origins = [...listOf(cors.origin), ...listOf(cors.origins)];
    const headers = listOf(cors.headers);
    const maxAge = Number(cors.maxAge);
    return {
        origins: origins.length ? origins : ['*'],
        headers: headers.length ? headers : [...DEFAULT_CORS_HEADERS],
        allowCredentials: cors.allowCredentials === true,
        ...(Number.isFinite(maxAge) && maxAge > 0 ? { maxAge } : {}),
    };
};

//* v5 B20: one `http` event (string `GET /path` or object form) → route (or `null` if invalid).
export const routeOfHttpEvent = (fn: string, http: any, doc: any): GatewayRoute | null => {
    const h = resolveSelf(http, doc);
    if (typeof h === 'string') {
        const [method, p] = h.trim().split(/\s+/);
        if (!method || p === undefined) return null;
        return { fn, method: method.toUpperCase(), resource: normalizePath(p), cors: null };
    }
    if (!h || typeof h !== 'object') return null;
    const method = `${resolveSelf(h.method, doc) ?? ''}`.trim().toUpperCase();
    const p = resolveSelf(h.path, doc);
    if (!method || typeof p !== 'string') return null;
    return { fn, method, resource: normalizePath(p), cors: normalizeCors(resolveSelf(h.cors, doc)) };
};

//* v5 B20: binary media types of the doc (`*~1*` as API Gateway stores it is read as `*/*`).
const binaryTypesOf = (doc: any): string[] =>
    listOf(resolveSelf(pick(doc, 'provider.apiGateway.binaryMediaTypes'), doc)).map(s => s.replace(/~1/g, '/'));

//* v5 B20: every `functions.<fn>.events[].http` of a parsed doc.
export const routesOfDoc = (doc: any): GatewayRoute[] => {
    const fns = doc && typeof doc.functions === 'object' && doc.functions ? doc.functions : {};
    return Object.entries<any>(fns).flatMap(([fn, def]) => {
        const events: any[] = Array.isArray(def?.events) ? def.events : [];
        return events
            .filter(e => e && typeof e === 'object' && e.http !== undefined)
            .map(e => routeOfHttpEvent(fn, e.http, doc))
            .filter((r): r is GatewayRoute => !!r);
    });
};

//* v5 B20: the legacy devkit routes (`/{type}`, `/{type}/{id}`, `/{type}/{id}/{cmd}`, any method, cors on).
export const legacyRoutes = (): GatewayRoute[] =>
    ['/{type}', '/{type}/{id}', '/{type}/{id}/{cmd}'].map(resource => ({
        fn: 'legacy',
        method: 'ANY',
        resource,
        cors: normalizeCors(true),
    }));

//* v5 B20: load the route table from `serverless.yml` (else the legacy routes + one warning).
export const loadRouteTable = (options?: {
    serverlessFile?: string;
    binaryMediaTypes?: string[];
}): GatewayRouteTable => {
    const file = path.resolve(process.cwd(), options?.serverlessFile || 'serverless.yml');
    const extra = listOf(options?.binaryMediaTypes);
    const legacy = (why: string): GatewayRouteTable => ({
        source: 'legacy',
        routes: legacyRoutes(),
        binaryMediaTypes: extra,
        warning: `! local-gateway: ${why} → legacy routes /{type}/{id}/{cmd}`,
    });
    if (!fs.existsSync(file)) return legacy(`no ${path.basename(file)}`);
    let doc: any;
    try {
        doc = parseServerlessYaml(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return legacy(`${path.basename(file)} is not readable yaml (${`${e?.message ?? e}`.split('\n')[0]})`);
    }
    const routes = routesOfDoc(doc);
    if (!routes.length) return legacy(`no http events in ${path.basename(file)}`);
    const binaryMediaTypes = Array.from(new Set([...binaryTypesOf(doc), ...extra]));
    return { source: 'serverless', routes, binaryMediaTypes };
};
