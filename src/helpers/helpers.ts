/**
 * `helpers.ts`
 * - helper functions used globally in project
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-12-22 initial version
 * @date        2021-12-21 protocol support `//self` url.
 * @date        2021-12-23 optimize types of $protocol.
 * @date        2022-03-17 addition text processing. (S2, P)
 *
 * @copyright (C) 2021 LemonCloud Co Ltd. - All Rights Reserved.
 */
import $cores, { APIHeaders, APIHttpMethod, ApiHttpProxy, NextContext, NextIdentityCognito } from '../cores/';
import { ProtocolModule, ProtocolService, SimpleSet } from '../cores/';
import $engine, { $U, doReportSlack, do_parallel } from '../engine/';
import { GETERR, onlyDefined } from '../common/test-helper';
import { sigV4Client, sigV4ClientConfig } from '../extended/libs/sig-v4';
import { performance } from 'perf_hooks';

import REQUEST from 'request';
import queryString from 'query-string';

/**
 * Helpers to transform data-types.
 */
export const $T = {
    /**
     * transform to string w/ trim()
     */
    S: (val: any, def = ''): string => `${val ?? def}`.trim(),
    /**
     * as string w/o white-space.
     */
    S2: (val: any, def = '', delim = ''): string => `${val ?? def}`.replace(/\s+/g, delim),
    /**
     * transform to string[]
     */
    SS: (val: any, def = [] as string[]): string[] => {
        if (val === null || val === undefined) return def;
        if (typeof val === 'string') return val ? val.split(',').map(_ => $T.S(_, '').trim()) : def;
        if (Array.isArray(val)) return val.length > 0 ? val.map(_ => $T.S(_, '').trim()) : def;
        return [$T.S(val)];
    },
    /**
     * text to Plain text (remove html tag)
     */
    P: (text: string, max = 0) => {
        const msg = (typeof text === 'string' ? text : `${text || ''}`)
            .replace(/<[^>]*>/g, ' ') //* remove html tag.
            .replace(/[^a-zA-Z0-9가-힣ㅋ-ㅎㅏ-ㅣ\.\?]+/g, ' ') //* remove non-char.
            .trim();
        const len = msg.length;
        return max && len > max ? msg.substring(0, max) + '...' : msg;
    },
    /**
     * transform to number(integer).
     */
    N: (val: any, def = 0): number => {
        const n = $U.N(val, def);
        return Number.isNaN(n) ? def : n;
    },
    /**
     * number array
     */
    NN: (val: any, def = [] as number[]): number[] => {
        if (val === null || val === undefined) return def;
        if (typeof val === 'string') return val ? val.split(',').map(_ => $T.N(_, 0)) : def;
        if (Array.isArray(val)) return val.length > 0 ? val.map(_ => $T.N(_, 0)) : def;
        return [$T.N(val)];
    },
    /**
     * transform to number(float)
     */
    F: (val: any, def = 0): number => $U.F(val, def),
    /**
     * transform to number(float)[]
     */
    FF: (val: any, def = [] as number[]): number[] => {
        if (val === null || val === undefined) return def;
        if (typeof val === 'string') return val ? val.split(',').map(_ => $T.F(_, 0)) : def;
        if (Array.isArray(val)) return val.length > 0 ? val.map(_ => $T.F(_, 0)) : def;
        return [$T.F(val)];
    },
    /**
     * float w/ fixed len=3
     */
    F3: (n: number, e = 0.000001) => Number((n + e).toFixed(3)),
    /**
     * transform to boolean.
     */
    B: (val: any, def: 0 | 1 = 0): 0 | 1 => {
        if (val === null || val === undefined) return def as 0 | 1;
        if (typeof val === 'boolean') return val ? 1 : 0;
        if (typeof val === 'string' && ['y', 'yes', 't', 'true'].includes(val.toLowerCase())) return 1;
        return $U.N(val, def) && 1;
    },
    /**
     * transform to Time number via string | number.
     */
    T: (val: any, def = 0): number => {
        const checkVal = `${val || ''}`.includes('-');
        if (checkVal) {
            if ($U.dt(val)) return $U.dt(val).getTime();
            else throw new Error(`@val[${val}] is invalid!`);
        } else {
            return $U.dt($U.N(val, def)).getTime();
        }
    },
    /**
     * transform to Date formatted string
     */
    D: (val: any, def = ''): string => {
        let s = $T.S(val);
        let y: string;
        let m: string;
        let d: string;
        if (s.includes('-')) {
            [y, m, d] = s.split('-');
        } else {
            y = s.slice(0, 4);
            m = s.slice(4, 6);
            d = s.slice(6);
        }
        s = [y, m, d]
            .filter(e => e?.length > 0)
            .map(e => e.padStart(2, '0'))
            .join('-');
        if (y && y.length === 4 && !Number.isNaN(Date.parse(s))) return s;
        return def;
    },
    /**
     * date-time format
     */
    DT: (val: any, def = '2020-01-01'): string => {
        const s = $T.D(val, '').split('-'); // must be valid date-format like '2000-01-02'
        const d = def.split('-');
        return d
            .map((d, i) => s[i] || d || '01')
            .map(e => e.padStart(2, '0'))
            .join('-');
    },
    /**
     * Extract Text
     */
    EX: (data: string, txt1: string, txt2: string) => {
        data = `${data || ''}`;
        const a = data.indexOf(txt1);
        const b = a >= 0 ? data.indexOf(txt2, a + txt1.length) : a;
        return b > a ? data.substring(a + txt1.length, b) : '';
    },
    /**
     * transform to simple-set.
     * @param val json object.
     */
    simples: (val: any, throws: boolean = false): SimpleSet => {
        //* validate if simple-type (string | number | null | undefined)
        const t = typeof val;
        if (val === undefined) return undefined;
        else if (val === null || val === '') return { _: null };
        else if (t === 'string' || t === 'number') return { _: val };
        else if (t === 'object' && !Array.isArray(val)) {
            const keys = Object.keys(val);
            const reName = /^[a-z_][a-zA-Z0-9_\-]*$/;
            return keys.reduce((N: SimpleSet, k: string) => {
                const v = val[k];
                if (v === undefined) {
                    //* NOP
                } else if (reName.test(k)) {
                    const t = typeof v;
                    if (v === null || v === '') N[k] = null;
                    else if (t === 'string' || t === 'number') N[k] = v;
                    else if (throws) throw new Error(`.${k}[${v}] is invalid!`);
                } else if (throws) throw new Error(`.${k} is invalid format!`);
                return N;
            }, {});
        } else if (throws) throw new Error(`@val[${t}] is invalid!`);
        return {};
    },
    /**
     * catch string between txt1 and txt2
     * @param data string
     * @param txt1 head
     * @param txt2 tail
     */
    catch: (data: any, txt1: string, txt2: string) => {
        data = typeof data == 'string' ? data : `${data}`;
        const a = data.indexOf(txt1);
        const b = a >= 0 ? data.indexOf(txt2, a + txt1.length) : a;
        const c = b > a ? data.substring(a + txt1.length, b) : '';
        return c;
    },
    /**
     * merge simple-set from $org to $new
     * @param $org the origin set
     * @param $new the update set.
     */
    merge: ($org: SimpleSet, $new: SimpleSet) => {
        if (!$new) return $org;
        return Object.keys($new).reduce(
            (N: SimpleSet, k: string) => {
                const val = $new[k];
                if (val === null || val === undefined) delete N[k];
                else N[k] = val;
                return N;
            },
            { ...$org },
        );
    },
    /**
     * replace message with template.
     */
    template: (msg: string, set: { [key: string]: string | number }) => {
        // const msg = $U.env('MSG_PHONE_CODE', '인증 번호는 [{code}] 입니다.') as string;
        const tmp: any = { ...set };
        return msg.replace(/\{(\w+)\}/g, (a, b) => (tmp[b] !== undefined ? `${tmp[b]}` : `{${b}}`));
    },
    /**
     * make random-code by length
     * @param size   length of code
     * @param rand  flag to use random (0 => 0, 1 => max)
     */
    makeRandomCode: (size: number = 6, rand?: boolean | number) => {
        const flag = rand === undefined || rand === true || typeof rand == 'number' ? true : false;
        const min = size >= 1 ? Math.pow(10, size - 1) : 1;
        const max = 10 * min - 1;
        const val =
            min + (flag ? Math.floor((max - min) * (typeof rand == 'number' ? rand : Math.random())) : max - min);
        return { val, min, max };
    },
    /**
     * 객체 정규화 시킴.
     * - null 에 대해서는 특별히 처리.
     */
    normal: <T = object>(N: T) =>
        Object.keys(N || {}).reduce<T>((M: T, k): T => {
            if (k.startsWith('_') || k.startsWith('$')) return M;
            const v = (N as any)[k];
            //* `null` 은 DynamoDB에서 비어있는 문자임.
            (M as any)[k] = v === null ? '' : v;
            return M;
        }, {} as any),
    /**
     * transform list to map by `id`
     */
    asMap: <T>(list: T[], id: string = 'id') =>
        list.reduce((M: { [key: string]: T }, N: T) => {
            const key = `${N[id as keyof T] || ''}`;
            M[key] = N;
            return M;
        }, {}),
    /**
     * compare object, and extract the only diff properties.
     */
    diff: <T = any>(A: T, B: T, onlyValid = false): T => {
        if (!A || !B) return B;
        else if (typeof A !== 'object' || typeof B !== 'object') return B;
        return $U
            .diff(A, B)
            .map(s => `${s || ''}`)
            .reduce((M: any, k) => {
                const org = (A as any)[k];
                const val = (B as any)[k];
                if (onlyValid) {
                    if (val !== undefined && val !== null) {
                        //* dynamo 에서는 null 과 '' 이 같음.
                        if (org === null && val === '') {
                            // NOP - due to same value.
                        } else {
                            M[k] = val;
                        }
                    }
                } else {
                    M[k] = val === undefined && org !== undefined ? null : val;
                }
                return M;
            }, {});
    },
    /**
     * get $perf instance.
     * ```ts
     * const p = $T.perf()
     * ...
     * const took = p.took(); // elapsed time in seconds
     */
    perf: () => {
        return new (class MyPerfmance {
            /** the initial timestamp (msec) */
            public readonly t0: number;
            /** constructor */
            public constructor(t0?: number) {
                this.t0 = t0 || performance.now(); // start of processing
            }
            /** get elapsed time (sec) */
            public took = () => {
                const t1 = performance.now(); // start of processing
                const took = Math.round((t1 - this.t0) / 10) / 100; // in sec.
                return took;
            };
        })();
    },
    /**
     * parse `.meta` property as object.
     * @param meta any
     */
    parseMeta: <T extends { type?: string; value?: any; error?: string; list?: any[]; [key: string]: any }>(
        meta: any,
    ): T => {
        if (typeof meta === 'string' && meta) {
            try {
                if (meta.startsWith('[') && meta.endsWith(']')) {
                    const list: any[] = JSON.parse(meta);
                    const $ret: any = { list };
                    return $ret as T;
                } else if (meta.startsWith('{') && meta.endsWith('}')) {
                    return JSON.parse(meta) as T;
                } else {
                    const $ret: any = { type: 'string', value: meta };
                    return $ret;
                }
            } catch (e) {
                const $ret: any = { type: 'string', value: meta, error: GETERR(e) };
                return $ret;
            }
        } else if (meta === null || meta === undefined) {
            return null;
        } else if (typeof meta === 'object') {
            return meta as T;
        } else {
            const type = typeof meta;
            const $ret: any = { type, value: meta };
            return $ret;
        }
    },
    /**
     * clear the undefined properties from the cloned object.
     * - applied only to 1st depth.
     *
     * @param N object
     * @param $def default if not valid object.
     * @returns cloned object
     */
    onlyDefined: onlyDefined,
};

/**
 * random number generator
 */
export const $rand = {
    /**
     * list of number[] in n-size.
     */
    range: (n: number): number[] => [...Array(n).keys()],
    /**
     * generate random number
     */
    float: (from: number, to: number): number => Math.random() * (to - from) + from,
    /**
     * generate multiple float numbers
     */
    floats: (from: number, to: number, n: number): number[] => new Array(n).fill(0).map(() => $rand.float(from, to)),
    /**
     * generate an integer
     */
    integer: (from: number, to: number): number => Math.floor($rand.float(Math.ceil(from), Math.floor(to))),
    /**
     * generate multiple integers
     */
    integers: (from: number, to: number, n: number): number[] =>
        new Array(n).fill(0).map(() => $rand.integer(from, to)),
};

/**
 * builder to support protocol-service.
 * @param context   the current context (or service name).
 * @param service   service name
 * @param options   additional options.
 */
export const $protocol = (
    context: NextContext | string = {},
    service?: string,
    options?: {
        param?: any;
        body?: any;
        isProd?: boolean;
    },
) => {
    //* for backward compartibility. shift arguments if 1st context is string.
    const ctx = typeof context === 'string' ? {} : context;
    service = typeof context === 'string' ? context : service;
    const param: any = typeof context === 'string' ? service : options?.param;
    const body: any = typeof context === 'string' ? param : options?.body;
    if (!ctx) throw new Error(`@context (NextContext) is required!`);
    if (!service) throw new Error(`@service (string) is required!`);
    const $proto: ProtocolService = $cores.protocol.service;
    const isProd = options?.isProd !== undefined ? options?.isProd : $U.env('NS') === 'SS' ? true : false;
    //TODO - `STAGE` is not changed from env.yml file @211215.
    // _inf(NS, 'NS =', $U.env('NS'), $engine.cores.config.config.get('NS'), process.env['NS']);
    // _inf(NS, 'stage =', $U.env('STAGE'), $engine.cores.config.config.get('STAGE'), process.env['STAGE']); //NOTE - STAGE is not changed.
    //* prod용 lambda접근을 위한 환경 구성!!!!!
    const $param = (p: any, b: any, x?: any) => {
        const protoParam = {
            ...$proto.fromURL(ctx, asTargetUrl(), p || param, b || body),
            ...x,
        };
        if (isProd) protoParam.stage = 'prod';
        return protoParam;
    };
    const $callback = (callback?: string) => {
        if (callback) {
            const [path, qs] = callback.split('?');
            if (path) {
                const [type, id, cmd] = path.split('/');
                const param = queryString.parse(qs);
                return { type, id, cmd, param };
            }
        }
    };

    //* find the target protocol-url from context.
    const asTargetUrl = (): string => {
        if (!service.startsWith('//')) throw new Error(`@service[${service}] (string) is invalid!`);
        if (service.startsWith('//self/')) {
            const self = $proto.myProtocolURI(ctx);
            const [a, b] = [self.indexOf('@'), self.indexOf('#')];
            const target =
                self.substring(a < 0 ? 'api://'.length : a + 1, b > a ? b : self.length) +
                service.substring('//self'.length);
            return `api://${target}`;
        } else {
            return `api:${service}`;
        }
    };
    //* execute via protocol-service.
    const execute = <T = any>(param?: any, body?: any, mode: string = 'POST'): Promise<T> =>
        $proto.execute($param(param, body, { mode }));
    // eslint-disable-next-line prettier/prettier
    const enqueue = <T = any>(
        param?: any,
        body?: any,
        mode: string = 'POST',
        callback?: string,
        delaySeconds: number = 1,
    ): Promise<string> => $proto.enqueue($param(param, body, { mode }), $callback(callback), delaySeconds);
    const notify = (param?: any, body?: any, mode: string = 'POST', callback?: string): Promise<string> =>
        $proto.notify($param(param, body, { mode }), $callback(callback));

    //* returns instance.
    return {
        hello: () => `helper:protocol:${service || ''}`,
        asTargetUrl,
        execute,
        enqueue,
        notify,
    };
};

/**
 * get the current config info
 */
export const $info = () => {
    const $conf = $cores.config.config;
    const service = $conf.getService();
    const version = $conf.getVersion();
    const stage = $conf.getStage();
    return { service, version, stage };
};

/**
 * send message to slack/public
 *
 * @param title 헤터 타이틀
 * @param text object or 텍스트 내용
 * @param pretext (optional) 텍스트 미리보기용.
 * @param params (optional) customize more options.
 */
export const $slack = async (
    title?: string,
    text?: string | object,
    pretext?: string,
    params?: {
        channel?: string;
        color?: string;
        scope?: string;
        fields?: { title: string; value: string; short?: boolean }[];
        footer?: string;
        context?: NextContext;
        ts?: number;
    },
) => {
    //* about current service.................
    const { service, version, stage } = $info();
    const name = `${service}#${version}` + (stage !== 'prod' ? `/${stage}` : '');
    return doReportSlack(
        params?.channel ? `!${params?.channel}` : 'public',
        {
            channel: params?.channel ?? undefined,
            attachments: [
                $T.onlyDefined({
                    color: `${params?.color || '#FFB71B' || 'good'}`,
                    title,
                    pretext:
                        pretext === null
                            ? undefined
                            : pretext ?? (params?.scope ? `#${name} [\`${params.scope}\`]` : undefined),
                    text:
                        text === null || text === undefined
                            ? undefined
                            : typeof text === 'string'
                            ? text
                            : $U.json(text),
                    fields: params?.fields,
                    footer: params?.footer === null ? undefined : params?.footer ?? `${service}/${stage}#${version}`,
                    ts: params?.ts === null ? undefined : Math.floor($U.current_time_ms() / 1000),
                }),
            ],
        },
        params?.context,
    ).catch(e => `#err:${GETERR(e)}`);
};

/**
 * event producer builder
 * @param context   current context
 * @param defEndpoint (optional) the default endpoint.
 */
export const $event = (context: NextContext, defEndpoint: string = '') => {
    const $protocol: ProtocolModule = $cores.protocol;
    const endpoint = $U.env('EVENT_RELAY_SNS', defEndpoint);
    if (!endpoint) throw new Error(`env[EVENT_RELAY_SNS] is required - $event()`);

    return {
        publish: async (body: { [key: string]: any }): Promise<string> =>
            $protocol.service.broadcast(context, endpoint, body),
    };
};
/**
 * authentication helper - get identity-id from context
 * @param context the current context
 */
export function getIdentityId(context?: NextContext | null): string | undefined {
    const identityId = (context?.identity as NextIdentityCognito)?.identityId;
    if (!identityId && context?.domain === 'localhost') {
        //* use `env[LOCAL_ACCOUNT]` only if runs in local server.
        return $U.env('LOCAL_ACCOUNT', '');
    }
    return identityId;
}

/**
 * authentication helper - check user is authorized
 * - 이 메서드는 AWS IAM 인증 여부만을 확인한다.
 * - 따라서 true를 반환한다고 하여 회원 가입이 되어있다는 의미는 아니다.
 *
 * @param context the current context
 * @params params (optional) to override `identity` when running local.
 */
export function isUserAuthorized(context: NextContext, params?: any): boolean {
    const identityId = getIdentityId(context);
    //WARN - in local server, override the identity w/ param
    if (context?.domain === 'localhost') {
        //!* override with optional parameter.
        if (context) {
            context.identity = {
                ...(params !== undefined ? params : context.identity),
                identityId,
            };
        }
    }
    return !!identityId;
}

/**
 * parse range expression
 * @param exp   range expression (e.g. '[63100 TO 224000]' or '[* TO 150000}')
 */
export function parseRange(exp: string): any {
    const match = exp.match(/^([\[{])([0-9]+|\*) TO ([0-9]+|\*)([}\]])$/);
    if (match && (match[2] !== '*' || match[3] !== '*')) {
        const range: any = {};
        if (match[2] !== '*') {
            const n = $T.N(match[2]);
            if (match[1] === '[') range.gte = n;
            else if (match[1] === '{') range.gt = n;
        }
        if (match[3] !== '*') {
            const n = $T.N(match[3]);
            if (match[4] === ']') range.lte = n;
            else if (match[4] === '}') range.lt = n;
        }
        return range;
    }
}

/**
 * customized of `do_parallel` for safe error-handling.
 * - use `.error` to report the internal error.
 *
 * @param list list of model.
 * @param func callback to process of each
 * @param params (optional) size of parallel (default 10) or options. (for comparibility with `do_parallel()`)
 */
export const my_parallel = async <
    T extends { id?: string; error?: string | null },
    U extends { id?: string; error?: string | null },
>(
    list: T[],
    func: (item: T, index: number) => Promise<U>,
    params?:
        | number
        | {
              /** size of parallel execution (default 10) */
              size?: number;
              /** throw error if any item fails (default: false) */
              throwable?: boolean;
              /** error scope for context tracking */
              errScope?: string;
              /** report to slack when completed (default: false) - TODO */
              reportSlack?: boolean;
              /** context for slack reporting */
              context?: NextContext;
          },
) => {
    const options = typeof params === 'number' ? { size: params } : params || {};
    const DEF_SIZE = $U.env('MY_PARALLEL_SIZE', '10'); // use env variable for default size.
    const DEF_THROW = $U.env('MY_PARALLEL_THROW', '1'); // use env variable for default size.
    const size = options?.size ?? $T.N(DEF_SIZE);
    const throwable = options?.throwable ?? ($T.B(DEF_THROW) ? true : false);
    const errScope = options?.errScope ?? `parallel(${size}/${list?.length || 0})`;
    if (!list?.length) return [];

    //* run parallel execution
    const results = await do_parallel(
        list,
        (N, i) => {
            const ret = (() => {
                try {
                    return func(N, i);
                } catch (e) {
                    return Promise.reject(e);
                }
            })();
            const res = ret instanceof Promise ? ret : Promise.resolve(ret);
            return res.catch(e => ({ ...N, id: N?.id, error: e instanceof Error ? e : new Error(e) }));
        },
        size,
    );

    //* analyze and handle errors
    const errors = results
        .map<Error>((N: any) => N?.error)
        .filter(e => (typeof e === 'object' && e instanceof Error ? true : false));
    //* calculate statistics
    const total = $T.N(list.length);
    const failed = $T.N(errors.length);
    const success = $T.N(total - failed);

    class MyError extends Error {
        constructor(message: string, public readonly cause?: unknown) {
            super(message);
            this.name = 'MyError';
        }
    }
    //* build error message
    if (throwable && failed > 0) {
        const msg = GETERR(errors[0]);
        const cnt = failed > 1 ? ` (+${failed - 1} more errors)` : '';
        throw new MyError(
            `${msg}${cnt} (S:${success}/${total}) - ${errScope}`,
            errors?.map(e => new MyError(GETERR(e), e)),
        );
    }

    //* make sure to transform error objects.
    return results.map<U>((N: any) =>
        N?.error === undefined
            ? N
            : {
                  ...N,
                  error: N?.error === null ? null : GETERR(N.error),
              },
    );
};

/**
 * alias of `my_parallel`
 * - compatibility for typo in previous version.
 */
export const my_parrallel = my_parallel;

/**
 * run in sequence order
 * - same as `my_parallel(list, func, 1)`;
 *
 * 주의) 내부 error를 throw 하지 않으니, list 를 전부 처리할때까지 안끝남.
 *
 * @param list list of model.
 * @param func callback to process of each
 */
export const my_sequence = <T extends { id?: string; error?: string | null }, U = T>(
    list: T[],
    func: (item: T, index?: number) => Promise<U>,
) => my_parallel<T, U>(list, func, 1);

/**
 * create api-http-proxy with sig-v4 agent, which using endpoint as proxy server.
 *
 * # as cases.
 * as proxy agent: GET <endpoint>/<host?>/<path?>
 * as direct agent: GET <endpoint>/<id?>/<cmd?>
 *
 * @param name              client-name
 * @param endpoint          service url (or backbone proxy-url)
 * @param sigConfig         sig-v4 client-config
 * @param options           optional parameters
 */
export const createSigV4Proxy = (
    /** name of client */
    name: string,
    /** endpoint of service */
    endpoint: string,
    /** sig-v4 client-config */
    sigConfig?: sigV4ClientConfig,
    /** (optional) parameters */
    options?: {
        /** headers */
        headers?: APIHeaders;
        /** path encoder (default encodeURIComponent) */
        encoder?: (name: string, path: string) => string;
        /** relay-key in headers for proxy. */
        relayHeaderKey?: string;
        /** resultKey in response */
        resultKey?: string;
        /** flag to print log (default false) */
        verbose?: boolean;
    },
): ApiHttpProxy => {
    const errScope = `createSigV4Proxy(${name ?? ''})`;
    if (!endpoint) throw new Error(`@endpoint (url) is required - ${errScope}`);
    const NS = $U.NS(`X${name ?? ''}`, 'magenta'); // NAMESPACE TO BE PRINTED.
    const encoder = options?.encoder ?? ((name, path) => path);
    const relayHeaderKey = options?.relayHeaderKey ?? '';
    const resultKey = options?.resultKey ?? '';
    const verbose = options?.verbose ?? false;

    const _log = verbose ? $engine.log : () => {};
    const _err = verbose ? $engine.err : () => {};
    const _inf = verbose ? $engine.inf : () => {};

    // initialize AWS SigV4 Client
    const sigClient = sigConfig ? sigV4Client({ ...sigConfig, endpoint }) : null;

    /**
     * class: `ApiHttpProxy`
     * - http proxy client via backbone's web.
     */
    return new (class implements ApiHttpProxy {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        public constructor(readonly headers?: APIHeaders) {}
        public hello = () => `http-web-proxy:${name}`;
        public doProxy<T = any>(
            method: APIHttpMethod,
            path1?: string,
            path2?: string,
            $param?: any,
            $body?: any,
            $ctx?: any,
        ): Promise<T> {
            if (!method) throw new Error(`@method is required - ${errScope}`);
            if (!endpoint?.startsWith('http') && !endpoint?.startsWith('https'))
                throw new Error(`@endpoint[${endpoint}] is invalid - ${errScope}`);
            _inf(NS, `doProxy(${method})..`);
            const _isNa = (a: any) => a === undefined || a === null;
            _log(NS, '> endpoint =', endpoint);
            _isNa(path1) && _log(NS, `> host(id) =`, typeof path1, path1);
            _isNa(path2) && _log(NS, `> path(cmd) =`, typeof path2, path2);

            //* prepare request parameters
            // eslint-disable-next-line prettier/prettier
            const query_string = _isNa($param)
                ? ''
                : typeof $param == 'object'
                ? queryString.stringify($param)
                : `${$param}`;
            const url =
                endpoint +
                (_isNa(path1) ? '' : `/${encoder('host', path1)}`) +
                (_isNa(path1) && _isNa(path2) ? '' : `/${encoder('path', path2)}`) +
                (!query_string ? '' : '?' + query_string);
            const request = REQUEST;
            const options: any = {
                method,
                uri: url,
                headers: { ...this.headers },
                body: $body === null ? undefined : $body,
                json: typeof $body === 'string' ? false : true,
            };

            if (sigClient) {
                const signedRequest = sigClient.signRequest({
                    method,
                    path:
                        (_isNa(path1) ? '' : `/${encoder('host', path1)}`) +
                        (_isNa(path1) && _isNa(path2) ? '' : `/${encoder('path', path2)}`),
                    queryParams: $param,
                    headers: options.headers,
                    body: $body,
                });
                options.headers = { ...options.headers, ...signedRequest.headers };
                options.uri = signedRequest.url;
            }

            //* relay HEADERS to `WEB-API`
            if (this.headers) {
                const headers = this.headers;
                options.headers = Object.keys(headers).reduce((H: any, key: string) => {
                    const val = headers[key];
                    const name = `${relayHeaderKey}${key}`;
                    const text = `${val}`;
                    H[name] = text;
                    return H;
                }, options.headers);
            }
            _log(NS, ' url :=', options.method, url);
            _log(NS, '*', options.method, url, options.json ? 'json' : 'plain');
            _log(NS, '> options =', $U.json(options));

            //* returns promise
            return new Promise((resolve, reject) => {
                //* start request..
                request(options, function (error: any, response: any, body: any) {
                    error && _err(NS, '>>>>> requested! err=', error);
                    if (error) return reject(error instanceof Error ? error : new Error(GETERR(error)));
                    //* detect trouble.
                    const statusCode = response.statusCode;
                    const statusMessage = response.statusMessage;
                    //* if not in success
                    if (statusCode !== 200 && statusCode !== 201) {
                        const msg = body ? GETERR(body) : `${statusMessage || ''}`;
                        if (statusCode === 400 || statusCode === 404) {
                            const title = `${(statusCode == 404 ? '' : statusMessage) || 'NOT FOUND'}`.toUpperCase();
                            const message = msg.startsWith('404 NOT FOUND') ? msg : `${statusCode} ${title} - ${msg}`;
                            return reject(new Error(message));
                        }
                        statusMessage && _log(NS, `> statusMessage[${statusCode}] =`, statusMessage);
                        body && _log(NS, `> body[${statusCode}] =`, $U.json(body));
                        return reject(new Error(`${statusCode} ${statusMessage || 'FAILURE'} - ${msg}`));
                    }
                    //* try to parse body.
                    try {
                        if (body && typeof body == 'string' && body.startsWith('{') && body.endsWith('}')) {
                            body = JSON.parse(body);
                        } else if (body && typeof body == 'string' && body.startsWith('[') && body.endsWith(']')) {
                            body = JSON.parse(body);
                        }
                    } catch (e) {
                        _err(NS, '!WARN! parse(body) =', e instanceof Error ? e : $U.json(e));
                    }
                    //* ok! succeeded.
                    resolve(body);
                });
            }).then((res: any) => {
                if (resultKey && res && res[resultKey] !== undefined) return res[resultKey];
                return res;
            });
        }
    })(options?.headers);
};
