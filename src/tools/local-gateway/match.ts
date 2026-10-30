/**
 * `tools/local-gateway/match.ts`
 * - v5 B20: route matching like API Gateway (REST v1) — resource first, then method.
 * - internal module (not exported from the root).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-31 initial version (v5 B20-b).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { GatewayRoute } from './routes';

//* v5 B20: the kind of one resource segment (lower rank = more specific).
type SegKind = 0 | 1 | 2; // 0 literal, 1 `{param}`, 2 `{proxy+}`

//* v5 B20: a parsed resource segment.
interface Seg {
    kind: SegKind;
    /** literal text, or the param name */
    text: string;
}

//* v5 B20: the result of a match.
export interface GatewayMatch {
    /** `matched` (resource + method), `method` (resource only → 403), `none` (no resource → 403) */
    status: 'matched' | 'method' | 'none';
    /** matched resource like `/{type}/{proxy+}` */
    resource?: string;
    /** decoded path parameters (`null` when the resource has none) */
    pathParameters?: { [key: string]: string } | null;
    /** the route of the method (exact first, else `ANY`) */
    route?: GatewayRoute;
    /** all routes of the matched resource (for CORS preflight) */
    routes?: GatewayRoute[];
}

//* v5 B20: split a resource into segments (`{name+}` is greedy, `{name}` a param).
const segsOf = (resource: string): Seg[] =>
    resource
        .split('/')
        .filter(s => s.length > 0)
        .map(s => {
            const g = /^\{([^}]+)\+\}$/.exec(s);
            if (g) return { kind: 2 as SegKind, text: g[1] };
            const p = /^\{([^}]+)\}$/.exec(s);
            if (p) return { kind: 1 as SegKind, text: p[1] };
            return { kind: 0 as SegKind, text: s };
        });

//* v5 B20: decode one path segment (a bad `%` sequence is kept as is).
const decodeSeg = (s: string): string => {
    try {
        return decodeURIComponent(s);
    } catch (e) {
        return s;
    }
};

//* v5 B20: try one resource against the request segments → ranks per segment + params, or `null`.
const tryResource = (segs: Seg[], parts: string[]): { ranks: number[]; params: { [k: string]: string } } | null => {
    const params: { [k: string]: string } = {};
    const ranks: number[] = [];
    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        //* `{proxy+}` only as the last segment, and it takes ≥ 1 remaining segment.
        if (seg.kind === 2) {
            if (i !== segs.length - 1 || parts.length <= i) return null;
            params[seg.text] = parts.slice(i).map(decodeSeg).join('/');
            ranks.push(2);
            return { ranks, params };
        }
        if (i >= parts.length) return null;
        if (seg.kind === 0) {
            if (decodeSeg(parts[i]) !== decodeSeg(seg.text)) return null;
        } else {
            params[seg.text] = decodeSeg(parts[i]);
        }
        ranks.push(seg.kind);
    }
    return segs.length === parts.length ? { ranks, params } : null;
};

//* v5 B20: lexical compare of rank lists (first differing segment decides; literal < param < proxy+).
const compareRanks = (a: number[], b: number[]): number => {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        const x = a[i] ?? -1;
        const y = b[i] ?? -1;
        if (x !== y) return x - y;
    }
    return 0;
};

/**
 * v5 B20: match a request path + method against the route table.
 * - resource precedence per segment: literal > `{param}` > `{proxy+}` (greedy, last segment, ≥ 1 segment).
 * - then the method: exact > `ANY`. A resource without the method is `status: 'method'` (API Gateway → 403).
 */
export const matchRoute = (routes: GatewayRoute[], method: string, pathname: string): GatewayMatch => {
    const parts = `${pathname ?? ''}`.split('/').filter(s => s.length > 0);
    const byResource = routes.reduce<{ [r: string]: GatewayRoute[] }>((M, r) => {
        (M[r.resource] = M[r.resource] || []).push(r);
        return M;
    }, {});
    //* the most specific resource that matches the whole path.
    let best: { resource: string; ranks: number[]; params: { [k: string]: string } } = null;
    for (const resource of Object.keys(byResource)) {
        const hit = tryResource(segsOf(resource), parts);
        if (!hit) continue;
        if (!best || compareRanks(hit.ranks, best.ranks) < 0) best = { resource, ...hit };
    }
    if (!best) return { status: 'none' };
    const list = byResource[best.resource];
    const M = `${method ?? ''}`.toUpperCase();
    const route = list.find(r => r.method === M) || list.find(r => r.method === 'ANY');
    const pathParameters = Object.keys(best.params).length ? best.params : null;
    return {
        status: route ? 'matched' : 'method',
        resource: best.resource,
        pathParameters,
        route,
        routes: list,
    };
};
