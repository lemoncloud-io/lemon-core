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
import $cores, { NextContext, NextIdentityCognito, ProtocolModule, ProtocolService } from '../cores/';
import { $U, doReportSlack, do_parrallel } from '../engine/';
import { GETERR } from '../common/test-helper';
import querystring from 'querystring';
import { performance } from 'perf_hooks';

/**
 * type: simple data-types
 * - it should be compartible with elastic-search.
 * - it should be consistancy within same key name.
 */
export interface SimpleSet {
    [key: string]: string | number;
}

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
            .replace(/<[^>]*>/g, ' ') //! remove html tag.
            .replace(/[^a-zA-Z0-9가-힣ㅋ-ㅎㅏ-ㅣ\.\?]+/g, ' ') //! remove non-char.
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
        //! validate if simple-type (string | number | null | undefined)
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
                    //! NOP
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
            //! `null` 은 DynamoDB에서 비어있는 문자임.
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
                        //! dynamo 에서는 null 과 '' 이 같음.
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
     * const took = p.took();
     */
    perf: () => {
        return new (class MyPerfmance {
            public readonly t0: number;
            public constructor(t0?: number) {
                this.t0 = t0 || performance.now(); // start of processing
            }
            public took = () => {
                const t1 = performance.now(); // start of processing
                const took = Math.round((t1 - this.t0) / 100) / 10; // in sec.
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
    //! for backward compartibility. shift arguments if 1st context is string.
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
    //! prod용 lambda접근을 위한 환경 구성!!!!!
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
                const param = querystring.parse(qs);
                return { type, id, cmd, param };
            }
        }
    };

    //! find the target protocol-url from context.
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
    //! execute via protocol-service.
    const execute = <T = any>(param?: any, body?: any, mode: string = 'POST'): Promise<T> =>
        $proto.execute($param(param, body, { mode }));
    // eslint-disable-next-line prettier/prettier
    const enqueue = <T=any>(param?: any, body?: any, mode: string = 'POST', callback?: string, delaySeconds: number = 1): Promise<string> =>
        $proto.enqueue($param(param, body, { mode }), $callback(callback), delaySeconds);
    const notify = (param?: any, body?: any, mode: string = 'POST', callback?: string): Promise<string> =>
        $proto.notify($param(param, body, { mode }), $callback(callback));

    //! returns instance.
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
    },
) => {
    //! about current service.................
    const { service, version, stage } = $info();
    const name = `${service}#${version}` + (stage !== 'prod' ? `/${stage}` : '');
    return doReportSlack(
        params?.channel ? `!${params?.channel}` : 'public',
        {
            channel: params?.channel ?? undefined,
            attachments: [
                {
                    color: `${params?.color || '#FFB71B' || 'good'}`,
                    title,
                    pretext: pretext ?? (params?.scope ? `#${name} [\`${params.scope}\`]` : undefined),
                    text: typeof text === 'string' ? text : $U.json(text),
                    ts: Math.floor($U.current_time_ms() / 1000),
                    fields: params?.fields,
                    footer: params?.footer ?? `${service}/${stage}#${version}`,
                },
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
 * @param ctx
 */
export function getIdentityId(ctx: NextContext): string | undefined {
    const identityId = (ctx?.identity as NextIdentityCognito)?.identityId;
    // for localhost development
    if (!identityId) {
        const profile = process.env.NAME;
        if (ctx.domain === 'localhost' && profile === 'lemon')
            return 'ap-northeast-2:009fa3a9-173f-440b-be74-2cf83370b08b';
        if (ctx.domain === 'localhost' && profile === 'colover')
            return 'ap-northeast-2:cef62bef-2f3e-4775-893f-7addb6efbeb3';
    }
    return identityId;
}

/**
 * authentication helper - check user is authorized
 * - 이 메서드는 AWS IAM 인증 여부만을 확인한다.
 * - 따라서 true를 반환한다고 하여 회원 가입이 되어있다는 의미는 아니다.
 *
 * @param ctx the current context
 * @param param (optional) to override `identity` when running local.
 */
export function isUserAuthorized(ctx: NextContext, param?: any): boolean {
    const identityId = getIdentityId(ctx);
    //NOTE - local 실행이라면 넘기자...
    if (ctx?.clientIp === '::1' && ctx?.domain === 'localhost') {
        ctx.identity = { ...param }; //! override with parameter.
        return true;
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
 * customized of `do_parrallel` for safe error-handling.
 * - use `.error` to report the internal error.
 *
 * @param list list of model.
 * @param func callback to process of each
 * @param size (optional) size of parrallel (default 10)
 */
export const my_parrallel = async <
    T extends { id?: string; error?: string },
    U extends { id?: string; error?: string },
>(
    list: T[],
    func: (item: T, index?: number) => Promise<U>,
    size?: number,
) => {
    const results = await do_parrallel(
        list,
        (item, i) => {
            const ret = (() => {
                try {
                    return func(item, i);
                } catch (e) {
                    return Promise.reject(e);
                }
            })();
            const res = ret instanceof Promise ? ret : Promise.resolve(ret);
            return res.catch(e => ({ id: item.id, error: GETERR(e) }));
        },
        size,
    );
    return results as unknown as U[];
};

/**
 * run in sequence order
 * - same as `my_parrallel(list, func, 1)`;
 *
 * 주의) 내부 error를 throw 하지 않으니, list 를 전부 처리할때까지 안끝남.
 *
 * @param list list of model.
 * @param func callback to process of each
 */
export const my_sequence = <T extends { id?: string; error?: string }, U = T>(
    list: T[],
    func: (item: T, index?: number) => Promise<U>,
) => my_parrallel(list, func, 1);
