/**
 * `lambda-web-chain.ts`
 * - nested `{proxy+}` paths on the default route, like `/houses/A/rooms/304`.
 * - a child is linked to its parent by the `<parent>Id` field in the child `manager.FIELDS`.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-11-03 initial version (v5 proxy decode).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { NextDecoder, NextHandler, NextMode } from 'lemon-model';
import { NUL404 } from '../../common/test-helper';
import type { CoreWEBController } from './lambda-web-handler';

export type WebHandlers = { [type: string]: NextDecoder | CoreWEBController };

/** the part of a CRUD `manager` the chain reads. */
interface ChainManager {
    FIELDS: string[];
    retrieve(id: string): Promise<any>;
}

/** one parent-child step of the chain. */
export interface ChainLink {
    /** the parent key in the child (`houseId`) */
    key: string;
    parent: string;
    parentId: string;
    type: string;
    id: string;
    manager: ChainManager;
}

/** the resolved target. */
interface Found {
    next: NextHandler;
    id: string;
    links: ChainLink[];
    /** the rest of the path for the fallback (`param.$sub`) */
    sub?: string;
}

/**
 * the next handler of a decoder (function) or a controller (object), as `handleProtocol()` does.
 */
export const nextOf = (
    decoder: NextDecoder | CoreWEBController,
    mode: NextMode,
    id: string,
    cmd: string,
    path?: string,
): NextHandler | null => {
    if (typeof decoder == 'function') {
        const next = decoder(mode, id, cmd, path);
        return typeof next == 'function' ? next : null;
    }
    if (decoder && typeof decoder == 'object') {
        const func = decoder.decode(mode, id, cmd, path);
        return func ? (i, p, b, c) => func.call(decoder, i, p, b, c) : null;
    }
    return null;
};

/** `param` without the client `$sub` (a copy only when it has one). */
export const dropSub = <T>(param: T): T => {
    if (!param || typeof param != 'object' || !('$sub' in param)) return param;
    const copy: any = { ...param };
    delete copy.$sub;
    return copy;
};

/** the CRUD manager of a handler, or null. */
const managerOf = (handler: NextDecoder | CoreWEBController): ChainManager | null => {
    // ponytail: CRUD manager read directly; add a public accessor if a non-CRUD controller needs chains
    const manager = (handler as any)?.manager;
    return manager && Array.isArray(manager.FIELDS) && typeof manager.retrieve == 'function' ? manager : null;
};

/**
 * first candidate of SPEC § 3.1 found in `fields`, else null.
 * - `houses`→`houseId`, `categories`→`categoryId`, `boxes`→`boxId`, `site-users`→`siteUserId`.
 */
export const parentKeyIn = (parentType: string, fields: string[]): string | null => {
    const t = `${parentType || ''}`;
    const camel = (s: string): string => s.replace(/-([a-z])/g, g => g[1].toUpperCase());
    const names = [
        t.endsWith('s') && t.slice(0, -1),
        t.endsWith('ies') && `${t.slice(0, -3)}y`,
        t.endsWith('es') && t.slice(0, -2),
        t,
    ];
    return (
        names
            .filter(n => !!n)
            .map(n => `${camel(n as string)}Id`)
            .find(k => (fields || []).includes(k)) ?? null
    );
};

/** the model of `id`, or null if missing (404) or deleted. other errors propagate. */
const modelOf = (manager: ChainManager, id: string): Promise<any> =>
    manager
        .retrieve(id)
        .catch(NUL404)
        .then(model => (model && !(model.deletedAt > 0) ? model : null));

/**
 * check one link: the child `id` exists and belongs to the parent. throws `404 NOT FOUND`.
 */
export const checkLink = async (link: ChainLink): Promise<void> => {
    const model = await modelOf(link.manager, link.id);
    const value = model ? model[link.key] : undefined;
    if (value === undefined || value === null || `${value}` !== link.parentId)
        throw new Error(`404 NOT FOUND - ${link.type}/${link.id} of ${link.parent}/${link.parentId}`);
};

/**
 * find the target by walking `(type, id)` pairs. the existing method comes first at each step
 * (the first step is `handleProtocol()`'s own decode), then the child, then the fallback (`$sub`).
 * - once it descends into a child, it never falls back to an ancestor (the links must be checked).
 */
const walk = (
    handlers: WebHandlers,
    mode: NextMode,
    type: string,
    id: string,
    segs: string[],
    links: ChainLink[],
): Found | null => {
    const decoder = handlers[type];
    const own = links.length ? nextOf(decoder, mode, id, segs.join('/')) : null;
    if (own) return { next: own, id, links };
    if (!segs.length) return null;
    const [child, childId = '', ...rest] = segs;
    const manager = managerOf(handlers[child]);
    const key = manager && parentKeyIn(type, manager.FIELDS);
    const link: ChainLink = key ? { key, parent: type, parentId: id, type: child, id: childId, manager } : null;
    if (link) return walk(handlers, mode, child, childId, rest, [...links, link]);
    const sub = segs.length > 1 ? nextOf(decoder, mode, id, child) : null;
    return sub ? { next: sub, id, links, sub: segs.slice(1).join('/') } : null;
};

/**
 * the handler that runs the checks of SPEC § 3.3 (in order), then calls the target.
 */
const guarded =
    (handlers: WebHandlers, mode: NextMode, found: Found): NextHandler =>
    async (_id, param, body, context) => {
        const { links, id } = found;
        //* `handleProtocol()` already dropped the client `$sub`.
        const query: any = param || {};
        //* the query parent key must equal the path.
        const conflict = links.find(l => query[l.key] !== undefined && `${query[l.key]}` !== l.parentId);
        if (conflict)
            throw new Error(`400 CONFLICT - .${conflict.key} (${query[conflict.key]}) != path (${conflict.parentId})`);
        //* the first parent exists (if CRUD).
        const first = links[0];
        const root = first && managerOf(handlers[first.parent]);
        if (root && !(await modelOf(root, first.parentId)))
            throw new Error(`404 NOT FOUND - ${first.parent}/${first.parentId}`);
        //* each child belongs to its parent (no target id, or POST `0`, is a new one).
        const last = links[links.length - 1];
        const creating = mode === 'POST' && (id === '' || id === '0');
        for (const link of links) {
            if (link === last && (link.id === '' || creating)) continue;
            await checkLink(link);
        }
        //* POST of a new one: fill the parent key in body (`null`/`''` counts as missing).
        const value = last && creating && body ? body[last.key] : undefined;
        if (last && creating && value !== undefined && value !== null && value !== '' && `${value}` !== last.parentId)
            throw new Error(`400 CONFLICT - .${last.key} (${value}) != path (${last.parentId})`);
        const $body = last && creating ? { ...(body || {}), [last.key]: last.parentId } : body;
        const $param = links.reduce((P, l) => ({ ...P, [l.key]: l.parentId }), {
            ...query,
            ...(found.sub !== undefined ? { $sub: found.sub } : {}),
        });
        return found.next(id, $param, $body, context);
    };

/**
 * resolve `cmd` as a chain of `(type, id)` (SPEC § 3.2), after the first step failed.
 * - null → 404 as today. throws `400 INVALID PATH`.
 */
export const resolveChain = (
    handlers: WebHandlers,
    mode: NextMode,
    type: string,
    id: string,
    cmd: string,
): NextHandler | null => {
    if (!handlers[type]) return null;
    const segs = `${cmd || ''}`.split('/');
    const bad = [id, ...segs].some(s => !s || s === '.' || s === '..' || s.startsWith('$'));
    if (bad) throw new Error(`400 INVALID PATH - /${type}/${id}/${cmd}`);
    const found = walk(handlers, mode, type, id, segs, []);
    return found ? guarded(handlers, mode, found) : null;
};
