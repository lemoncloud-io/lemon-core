/**
 * `cores/protocol/protocol-relay.ts`
 * - v5 B13: the relay envelope of an internal hop — a whitelisted identity and the trace, nothing else.
 * - web: header `x-lemon-relay`. SNS/SQS: the `relay` field of the protocol param (no `context` field).
 * - value `r1.<base64url(JSON)>`, JSON keys `idt tid hop src via pid iat`. signed by the existing signature
 *   (web: the relay string in the context slot of the canonical; SNS/SQS: the message signature).
 * - the legacy `x-protocol-context` (full context) is deprecated: `PROTOCOL_LEGACY_CONTEXT` (send) and
 *   `PROTOCOL_LEGACY_ACCEPT` (receive) decide whether it is sent and accepted. removal in v6.
 * - hop cap `PROTOCOL_MAX_HOP` (default 8): `508 LOOP DETECTED - protocol hop <n>` on send and on receive.
 * - NOTE: deep module only (`./dist/cores/protocol/protocol-relay`). not re-exported by the root.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 initial version (v5 B13)
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { randomUUID } from 'crypto';
import URL from 'url';
import { NextContext, NextIdentity, NextTrace } from 'lemon-model';
import { $U, _inf } from '../../engine/';
import { readConfig, HEADER_LEMON_RELAY } from './protocol-sign';
const NS = $U.NS('PRTS', 'yellow'); // NAMESPACE TO BE PRINTED.

/** header name of the web relay (defined in `protocol-sign.ts` for the log mask, re-exported here) */
export { HEADER_LEMON_RELAY };
/** field name of the relay in the SNS/SQS protocol param */
export const RELAY_PARAM = 'relay';
/** prefix (format version) of the relay value */
export const RELAY_PREFIX = 'r1.';
/** max bytes of a relay value (the receiver rejects a larger one) */
export const RELAY_MAX_BYTES = 4096;
/** identity fields that cross a hop (whitelist). nothing else of `NextIdentity` is relayed */
export const RELAY_IDENTITY_FIELDS = ['sid', 'uid', 'gid', 'roles', 'identityId', 'lang'] as const;
/** env name of the send mode of the legacy context (`off` | `send`) */
export const PROTOCOL_LEGACY_CONTEXT = 'PROTOCOL_LEGACY_CONTEXT';
/** env name of the receive mode of the legacy context (`accept` | `warn` | `reject`) */
export const PROTOCOL_LEGACY_ACCEPT = 'PROTOCOL_LEGACY_ACCEPT';
/** env name of the hop cap */
export const PROTOCOL_MAX_HOP = 'PROTOCOL_MAX_HOP';
/** default hop cap */
export const DEFAULT_MAX_HOP = 8;

/** send mode of the legacy context: `off` = relay only, `send` = relay and legacy (for v4 receivers) */
export type LegacySendMode = 'off' | 'send';
/** receive mode of the legacy context */
export type LegacyAcceptMode = 'accept' | 'warn' | 'reject';

/** the relayed identity (whitelist of `NextIdentity`) */
export interface RelayIdentity {
    sid?: string;
    uid?: string;
    gid?: string;
    roles?: string[];
    identityId?: string;
    lang?: string;
}

/** the relay JSON (`r1.` payload) */
export interface ProtocolRelay {
    /** identity summary (whitelist) */
    idt?: RelayIdentity;
    /** trace id: the requestId of the first entry */
    tid: string;
    /** hop of this call (caller hop + 1) */
    hop: number;
    /** the first request path uri */
    src?: string;
    /** service uri of the direct caller */
    via?: string;
    /** requestId of the direct caller */
    pid?: string;
    /** signing time (epoch seconds) */
    iat?: number;
}

//* the relay keys in the order they are written.
const RELAY_KEYS = ['idt', 'tid', 'hop', 'src', 'via', 'pid', 'iat'] as const;
//* max length of a string field of the relay.
const MAX_TEXT = 2048;

/** read the send mode of the legacy context (default `off`) */
export const readLegacySend = (): LegacySendMode =>
    `${readConfig(PROTOCOL_LEGACY_CONTEXT) ?? ''}`.trim().toLowerCase() === 'send' ? 'send' : 'off';

/** read the receive mode of the legacy context (default `warn`) */
export const readLegacyAccept = (): LegacyAcceptMode => {
    const mode = `${readConfig(PROTOCOL_LEGACY_ACCEPT) ?? ''}`.trim().toLowerCase();
    return mode === 'accept' || mode === 'reject' ? mode : 'warn';
};

/** read the hop cap (a positive integer, default 8) */
export const readMaxHop = (): number => {
    const n = Number(`${readConfig(PROTOCOL_MAX_HOP) ?? ''}`.trim() || NaN);
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_HOP;
};

/** throw `508 LOOP DETECTED` if the hop is over the cap */
export const assertHop = (hop: number, max: number = readMaxHop()): void => {
    if (hop > max) throw new Error(`508 LOOP DETECTED - protocol hop ${hop}`);
};

/** the whitelisted identity of a context (`undefined` if nothing to relay) */
export const relayIdentityOf = (identity?: NextIdentity): RelayIdentity => {
    if (!identity || typeof identity !== 'object') return undefined;
    const idt: RelayIdentity = {};
    const src: any = identity;
    //* copy only the whitelisted fields of the right type.
    RELAY_IDENTITY_FIELDS.forEach(k => {
        const v = src[k];
        if (k === 'roles') {
            if (Array.isArray(v)) idt.roles = v.filter(r => typeof r === 'string');
        } else if (typeof v === 'string') (idt as any)[k] = v;
    });
    return Object.keys(idt).length ? idt : undefined;
};

/**
 * build the relay of the next hop from the caller context.
 * - `tid` = caller `trace.tid`, else `requestId`, else a new id. `hop` = caller `trace.hop` + 1.
 * - `src` = caller `trace.src`, else `source`. `pid` = caller `requestId`. `via` = the caller's service uri.
 * - throws `508 LOOP DETECTED` if the next hop is over the cap (before any send).
 *
 * @param context   the caller context
 * @param options   `via` (caller uri), `now` (ms, for tests), `max` (hop cap)
 */
export const buildRelay = (
    context: NextContext,
    options?: { via?: string; now?: number; max?: number },
): ProtocolRelay => {
    const trace = context?.trace;
    const hop = (Number.isInteger(trace?.hop) && trace.hop >= 0 ? trace.hop : 0) + 1;
    assertHop(hop, options?.max);
    const text = (v: unknown): string => (typeof v === 'string' && v ? v : undefined);
    const relay: ProtocolRelay = {
        idt: relayIdentityOf(context?.identity),
        tid: text(trace?.tid) ?? text(context?.requestId) ?? randomUUID(),
        hop,
        src: text(trace?.src) ?? text(context?.source),
        via: text(options?.via),
        pid: text(context?.requestId),
        iat: Math.floor((options?.now ?? Date.now()) / 1000),
    };
    //* drop empty keys (smaller value, stable shape).
    return RELAY_KEYS.reduce<ProtocolRelay>((R, k) => {
        if (relay[k] !== undefined) (R as any)[k] = relay[k];
        return R;
    }, {} as ProtocolRelay);
};

/** encode a relay as `r1.<base64url(JSON)>` */
export const encodeRelay = (relay: ProtocolRelay): string =>
    `${RELAY_PREFIX}${Buffer.from(JSON.stringify(relay), 'utf8').toString('base64url')}`;

//* the error of a bad relay.
const invalid = (reason: string) => new Error(`400 INVALID CONTEXT - relay ${reason}`);

/**
 * decode and validate a relay value (shape, types, size). unknown keys and non-whitelisted identity keys are dropped.
 * - throws `400 INVALID CONTEXT - relay <reason>` (`format`, `size`, `json`, `shape`, or the bad key).
 */
export const decodeRelay = (text: string): ProtocolRelay => {
    if (typeof text !== 'string' || !text.startsWith(RELAY_PREFIX)) throw invalid('format');
    if (Buffer.byteLength(text, 'utf8') > RELAY_MAX_BYTES) throw invalid('size');
    //* base64url → JSON.
    const data: any = (() => {
        try {
            return JSON.parse(Buffer.from(text.substring(RELAY_PREFIX.length), 'base64url').toString('utf8'));
        } catch (e) {
            throw invalid('json');
        }
    })();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid('shape');
    //* string fields: optional, bounded.
    const str = (k: string, required?: boolean): string => {
        const v = data[k];
        if (v === undefined && !required) return undefined;
        if (typeof v !== 'string' || (required && !v) || v.length > MAX_TEXT) throw invalid(k);
        return v;
    };
    const relay: ProtocolRelay = { tid: str('tid', true), hop: data.hop };
    if (!Number.isInteger(data.hop) || data.hop < 0) throw invalid('hop');
    if (data.idt !== undefined) relay.idt = decodeIdentity(data.idt);
    ['src', 'via', 'pid'].forEach(k => {
        const v = str(k);
        if (v !== undefined) (relay as any)[k] = v;
    });
    if (data.iat !== undefined) {
        if (typeof data.iat !== 'number' || !Number.isFinite(data.iat)) throw invalid('iat');
        relay.iat = data.iat;
    }
    //* the key order of the encoder (so a decoded relay equals the built one).
    return RELAY_KEYS.reduce<ProtocolRelay>((R, k) => {
        if (relay[k] !== undefined) (R as any)[k] = relay[k];
        return R;
    }, {} as ProtocolRelay);
};

//* validate the `idt` of a relay (whitelisted keys only, typed).
const decodeIdentity = (idt: any): RelayIdentity => {
    if (!idt || typeof idt !== 'object' || Array.isArray(idt)) throw invalid('idt');
    const res: RelayIdentity = {};
    RELAY_IDENTITY_FIELDS.forEach(k => {
        const v = idt[k];
        if (v === undefined || v === null) return;
        if (k === 'roles') {
            if (!Array.isArray(v) || v.some(r => typeof r !== 'string')) throw invalid('idt.roles');
            res.roles = [...v];
        } else {
            if (typeof v !== 'string' || v.length > MAX_TEXT) throw invalid(`idt.${k}`);
            (res as any)[k] = v;
        }
    });
    return res;
};

/**
 * the receiver context of a relay (B13 D2 table).
 * - `identity` = `idt`, `channel` = `internal`, `depth` = `hop`, `source` = `src`, `trace` = `{ tid, hop, via, pid, src }`.
 * - `requestId`, `accountId` = the receiver's own values (`own`). nothing else of the caller crosses the hop.
 */
export const asRelayContext = (relay: ProtocolRelay, own?: NextContext): NextContext => {
    const trace: NextTrace = { tid: relay.tid, hop: relay.hop };
    if (relay.via !== undefined) trace.via = relay.via;
    if (relay.pid !== undefined) trace.pid = relay.pid;
    if (relay.src !== undefined) trace.src = relay.src;
    const context: NextContext = {
        identity: { ...(relay.idt || {}) },
        channel: 'internal',
        depth: relay.hop,
        source: relay.src,
        trace,
        requestId: own?.requestId,
        accountId: own?.accountId,
    };
    //* drop the undefined keys.
    return Object.entries(context).reduce<NextContext>((M, [k, v]) => {
        if (v !== undefined) (M as any)[k] = v;
        return M;
    }, {});
};

/** the channel of an entry without a protocol context: local mode wins, else `host` → `external`, else `internal` */
export const entryChannel = (hasHost: boolean): NextContext['channel'] =>
    $U.isLocalMode() ? 'local' : hasHost ? 'external' : 'internal';

/** the trace of an entry without a relay: `{ tid: requestId, hop: 0 }` (a new tid if no requestId) */
export const entryTrace = (context?: NextContext): NextTrace => ({
    tid: `${context?.requestId || ''}` || randomUUID(),
    hop: 0,
});

/**
 * apply `PROTOCOL_LEGACY_ACCEPT` to a legacy context (`x-protocol-context` or the SNS/SQS `context` field).
 * - `reject`: throws `400 INVALID CONTEXT - legacy context rejected`. `warn`: one line. `accept`: nothing.
 *
 * @param transport `web` | `sns` | `sqs` (for the log line)
 * @param legacy    the legacy context (for the log line: the service of its `source`)
 */
export const acceptLegacy = (transport: string, legacy?: NextContext): void => {
    const mode = readLegacyAccept();
    if (mode === 'reject') throw new Error(`400 INVALID CONTEXT - legacy context rejected`);
    if (mode === 'warn') _inf(NS, `PROTOCOL deprecated x-protocol-context ${hostOf(legacy?.source)} (${transport})`);
};

/** one `PROTOCOL deprecated json identity (<transport>)` line (not in `accept`). the behaviour is unchanged */
export const warnJsonIdentity = (transport: string): void => {
    if (readLegacyAccept() !== 'accept') _inf(NS, `PROTOCOL deprecated json identity (${transport})`);
};

//* a log token: no whitespace, bounded (a relay value cannot break the line).
const token = (v: unknown): string => {
    const s = `${v ?? ''}`.replace(/\s/g, '_').substring(0, 128);
    return s || '-';
};
//* the host (service) of a protocol uri, without the account and the version ('-' if none).
const hostOf = (uri?: string): string => {
    try {
        return token(uri ? URL.parse(uri).hostname : '');
    } catch (e) {
        return '-';
    }
};
//* the path of a protocol uri ('-' if none).
const pathOf = (uri?: string): string => {
    try {
        const path = uri ? URL.parse(uri).pathname : '';
        return token(path && path !== '/' ? path : '');
    } catch (e) {
        return '-';
    }
};

/**
 * the `TRACE` line of an entry: `TRACE tid=<tid> hop=<hop> ch=<channel> via=<service|-> src=<path|->`.
 * - no identity value, no account (the via host and the src path only).
 */
export const traceLine = (context: NextContext): string => {
    const trace = context?.trace;
    const src = trace?.src ?? context?.source;
    return [
        `TRACE tid=${token(trace?.tid)}`,
        `hop=${token(trace?.hop)}`,
        `ch=${token(context?.channel)}`,
        `via=${hostOf(trace?.via)}`,
        `src=${pathOf(src)}`,
    ].join(' ');
};

/** print the `TRACE` line of an entry (one per web entry and per protocol receive) */
export const logTrace = (context: NextContext): void => {
    _inf(NS, traceLine(context));
};

/** the account id (12 digits) of an ARN, or '' */
export const accountOfArn = (arn?: string): string => {
    const id = `${arn || ''}`.split(':')[4] || '';
    return /^\d{12}$/.test(id) ? id : '';
};
