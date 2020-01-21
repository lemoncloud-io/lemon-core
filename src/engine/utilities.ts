/**
 * `engine/utilities.ts`
 * - Simple Logger with timestamp + color
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { EngineCore, GeneralFuntion } from './types';
const NS = 'util';

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import crypto from 'crypto';
import QUERY_STRING from 'query-string';
import * as uuid from 'uuid';

/**
 * class: Utilities
 * - various functions
 */
export class Utilities {
    private _$: EngineCore;
    private log: GeneralFuntion;
    private err: GeneralFuntion;
    private name: string;

    public constructor(_$: EngineCore) {
        this._$ = _$;
        this.log = _$.log;
        this.err = _$.err;
        this.name = `${NS}-utils`;
    }

    protected lodash() {
        // use underscore util.
        const $_ = this._$._;
        if (!$_) throw new Error('$_(lodash) is required!');
        return $_;
    }

    //! some helper function.s
    public get_env(name: string, def_val?: string): any {
        if (typeof this._$.environ === 'function') return this._$.environ(name, def_val);

        // as default, load from proces.env.
        let val = (process && process.env[name]) || undefined;
        return val === undefined ? def_val : val;
    }

    public env(name: string, def_val?: string): any {
        return this.get_env(name, def_val);
    }

    public is_dev(): boolean {
        const env = this.get_env('ENV') || this.get_env('NODE_ENV') || this.get_env('STAGE');
        return env === 'production' || env === 'op' ? false : true;
    }

    public load_data_yaml(name: any, folder?: string): Promise<any> {
        if (!name) throw new Error('param:name is required!');
        folder = folder || 'data';

        //! calculate the target data file.
        const fname = path.resolve(__dirname, `../${folder}/` + name + (name.endsWith('.yml') ? '' : '.yml'));

        this.log(NS, 'load file =', fname);
        //! prepare promised.
        let chain = new Promise(function(resolve, reject) {
            // Get document, or throw exception on error
            try {
                let doc = yaml.safeLoad(fs.readFileSync(fname, 'utf8'));
                resolve(doc);
            } catch (e) {
                reject(e);
            }
        });
        return chain;
    }

    public load_sync_yaml(name: string, folder?: string): any {
        if (!name) throw new Error('param:name is required!');
        folder = folder || 'data';

        //! calculate the target data file.
        const fname = path.resolve(__dirname, `../${folder}/` + name + (name.endsWith('.yml') ? '' : '.yml'));

        // Get document, or throw exception on error
        try {
            this.log(NS, 'load-sync-file =', fname);
            let doc = yaml.safeLoad(fs.readFileSync(fname, 'utf8'));
            return doc;
        } catch (e) {
            this.err(NS, `error:load-sync-yaml(${name})=`, e);
        }
        return {};
    }

    public extend(a: any, b: any) {
        for (var x in b) a[x] = b[x];
        return a;
    }

    public isset(x: any) {
        return x === undefined ? false : true;
    }

    public empty(x: any) {
        return x ? false : true;
    }

    public min(a: any, b: any) {
        return a < b ? a : b;
    }

    public max(a: any, b: any) {
        return a > b ? a : b;
    }

    public round(a: any) {
        return Math.round(a);
    }

    public json(o: any, isSorted?: any) {
        if (isSorted) {
            var output: any = {};
            Object.keys(o)
                .sort()
                .forEach(function(key) {
                    output[key] = o[key];
                });
            o = output;
        }
        return (o && JSON.stringify(o)) || o;
    }

    // timestamp value.
    public static timestamp(date?: undefined | number | Date, timeZone?: number): string {
        const dt = date && typeof date === 'object' ? date : date ? new Date(date) : new Date();
        const now = new Date();
        const tzo = now.getTimezoneOffset(); // Asia/Seoul => -540
        const diff = timeZone * 60 + tzo;
        if (diff) dt.setSeconds(dt.getSeconds() + 1 * diff * 60);

        const y = dt.getFullYear();
        const m = dt.getMonth() + 1; //Months are zero based
        const d = dt.getDate();

        const h = dt.getHours();
        const i = dt.getMinutes();
        const s = dt.getSeconds();

        const d2 = (x: number) => `${x < 10 ? '0' : ''}${x}`;

        const ret = d2(y) + '-' + d2(m) + '-' + d2(d) + ' ' + d2(h) + ':' + d2(i) + ':' + d2(s);
        return ret;
    }

    // parse timestamp to date.
    public static datetime(dt?: string | number | Date, timeZone?: number) {
        let ret = null;
        if (typeof dt == 'string') {
            const now = new Date();
            const tzo = now.getTimezoneOffset();
            const diff = timeZone * 60 + tzo;
            let tstr = '';
            if (/^[12]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dt)) {
                // like 1978-12-01
                tstr = dt + ' 12:00:00';
            } else if (/^[4-9][0-9]-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dt)) {
                // like 79-12-01
                tstr = '19' + dt + ' 12:00:00';
            } else if (/^[0-3][0-9]-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dt)) {
                // like 19-12-01
                tstr = '20' + dt + ' 12:00:00';
            } else if (/^[12]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(dt)) {
                // like 1978-12-01 12:34
                tstr = dt + ':00';
            } else if (
                /^[12]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]) ([01]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/.test(dt)
            ) {
                // like 1978-12-01 12:34:20
                tstr = dt + '';
            } else if (/^[12]\d{3}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(dt)) {
                // like 19781201
                tstr = dt.substr(0, 4) + '-' + dt.substr(4, 2) + '-' + dt.substr(6, 2) + ' 12:00:00';
            } else if (/^[12]\d{3}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01]) ([01]?[0-9]|2[0-3])[0-5][0-9]$/.test(dt)) {
                // like 19781201 1234
                tstr =
                    dt.substr(0, 4) +
                    '-' +
                    dt.substr(4, 2) +
                    '-' +
                    dt.substr(6, 2) +
                    ' ' +
                    dt.substr(9, 2) +
                    ':' +
                    dt.substr(11, 2) +
                    ':00';
            }
            ret = ((ts: string) => {
                if (!ts) return null;
                const aa = ts.split(' ');
                const dd = aa[0].split('-');
                const hh = aa[1].split(':');
                const y = parseInt(dd[0]);
                const m = parseInt(dd[1]) - 1;
                const d = parseInt(dd[2]);
                const h = parseInt(hh[0]);
                const i = parseInt(hh[1]);
                const s = parseInt(hh[2]);
                return new Date(y, m, d, h, i, s, 0);
            })(tstr);
            if (ret && diff) ret.setSeconds(ret.getSeconds() + -1 * diff * 60);
            return ret;
        } else if (typeof dt == 'number') {
            ret = new Date(dt);
        } else if (typeof dt == 'object' && (dt as any) instanceof Date) {
            ret = dt;
        } else if (dt === undefined) {
            ret = new Date();
        } else {
            throw new Error('Invalid type of dt: ' + typeof dt);
        }
        return ret;
    }

    public ts(d?: undefined | number | Date, timeZone?: number) {
        return Utilities.timestamp(d, timeZone);
    }
    public dt(dt?: string | number | Date, timeZone?: number) {
        return Utilities.datetime(dt, timeZone);
    }

    public now() {
        return this.dt();
    }

    /**
     * 현재 시간값 (number of milliseconds since midnight of January 1, 1970.)
     *
     *
     * @returns {number}
     */
    public current_time_ms(shift?: number) {
        var time_shift = this.N(shift, 0);
        var ret = new Date().getTime();
        ret += time_shift;
        return ret;
    }

    /**
     * NameSpace Maker.
     */
    // eslint-disable-next-line prettier/prettier
    public NS(ns: string, color?: 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white', len?: number, delim?: string) {
        if (!ns) return ns;
        len = len || 4;
        len = len - ns.length;
        len = len < 0 ? 0 : len;
        const SPACE = '           ';
        ns = SPACE.substr(0, len) + ns + (delim === undefined ? ':' : `${delim || ''}`);
        if (color) {
            const COLORS: any = {
                red: '\x1b[31m',
                green: '\x1b[32m',
                yellow: '\x1b[33m',
                blue: '\x1b[34m',
                magenta: '\x1b[35m',
                cyan: '\x1b[36m',
                white: '\x1b[37m',
            };
            ns = COLORS[color] + ns + '\x1b[0m';
        }
        return ns;
    }

    // escape string for mysql.
    public escape(str: string, urldecode?: any) {
        if (str === undefined) return 'NULL';
        if (this.isInteger(str)) return str;
        str = str || '';
        if (typeof str == 'object') {
            str = JSON.stringify(str);
        }
        str = str
            .replace(/\\/g, '\\\\')
            .replace(/\$/g, '\\$')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"');

        if (urldecode) {
            // url-decode
            str = decodeURI(str);
        }
        return "'" + str + "'";
    }

    // convert to integer.
    public isInteger(x: any) {
        return typeof x === 'number' && x % 1 === 0;
    }

    public N(x: any, def?: any) {
        try {
            if (x === '' || x === undefined || x === null) return def;
            if (typeof x === 'number' && x % 1 === 0) return x;
            if (typeof x == 'number') return parseInt('' + x);
            x = '0' + x;
            x = x.startsWith('0-') ? x.substr(1) : x; // minus
            return parseInt(x.replace(/,/gi, '').trim());
        } catch (e) {
            this.err('err at _N: x=' + x + ';' + typeof x + ';' + (e.message || ''), e);
            return def;
        }
    }

    //! parse float number (like 1.01)
    public F(x: any, def?: any) {
        try {
            if (x === '' || x === undefined || x === null) return def;
            if (typeof x === 'number' && x % 1 === 0) return x;
            if (typeof x == 'number') return parseFloat('' + x);
            x = '0' + x;
            x = x.startsWith('0-') ? x.substr(1) : x; // minus
            return parseFloat(x.replace(/,/gi, '').trim());
        } catch (e) {
            this.err('err at _N: x=' + x + ';' + typeof x + ';' + (e.message || ''), e);
            return def;
        }
    }

    //! remove underscore variables.
    public cleanup($N: any) {
        return Object.keys($N).reduce(function($N, key) {
            if (key.startsWith('_')) delete $N[key];
            if (key.startsWith('$')) delete $N[key];
            return $N;
        }, $N);
    }

    //! remove underscore variables.
    public updated(that: any, that2: any) {
        const updated = Object.keys(that2).reduce((self: any, key) => {
            if (that[key] !== that2[key]) {
                if (that[key] === null && that2[key] === '') {
                    // both same.
                    return self;
                }
                self[key] = that2[key];
            }
            return self;
        }, {});
        return updated;
    }

    public copy($N: any) {
        return Object.keys($N).reduce(function($n: any, key) {
            $n[key] = $N[key];
            return $n;
        }, {});
    }

    public copy_node($N: any, isClear?: boolean) {
        isClear = isClear === undefined ? false : isClear;
        return Object.keys($N).reduce(function($n: any, key) {
            if (key.startsWith('_')) return $n;
            if (key.startsWith('$')) return $n;
            $n[key] = isClear ? null : $N[key];
            return $n;
        }, {});
    }

    //! clean up all member without only KEY member.
    public bare_node($N: any, opts?: any) {
        // return Object.keys($N).reduce(function($n, key) {
        // 	if(key.startsWith('_')) return $n;
        // 	if(key.startsWith('$')) return $n;
        // 	$n[key] = $N[key]
        // 	return $n;
        // }, {})
        let $n: any = {};
        $n._id = $N._id;
        $n._current_time = $N._current_time;
        if (opts) $n = this.extend($n, opts);
        return $n;
    }

    public diff(obj1: any, obj2: any): string[] {
        obj1 = obj1 || {};
        obj2 = obj2 || {};
        const $_ = this.lodash();
        const diff = Object.keys(obj1)
            .reduce((result, key) => {
                if (!obj2.hasOwnProperty(key)) {
                    result.push(key);
                } else if ($_.isEqual(obj1[key], obj2[key])) {
                    const resultKeyIndex = result.indexOf(key);
                    result.splice(resultKeyIndex, 1);
                }
                return result;
            }, Object.keys(obj2))
            .sort();

        return diff;
    }

    /**
     * calcualte node differences
     *
     * @param obj1
     * @param obj2
     */
    public diff_node(obj1: any, obj2: any) {
        let keys1: any = [],
            keys2: any = [];
        const $_ = this.lodash();
        Object.keys(obj1).forEach(key => {
            if (key.startsWith('_')) return;
            if (key.startsWith('$')) return;
            keys1.push(key);
        });
        Object.keys(obj2).forEach(key => {
            if (key.startsWith('_')) return;
            if (key.startsWith('$')) return;
            keys2.push(key);
        });
        const diff = keys1.reduce((result: any, key: string) => {
            if (!obj2.hasOwnProperty(key)) {
                result.push(key);
            } else if ($_.isEqual(obj1[key], obj2[key])) {
                const resultKeyIndex = result.indexOf(key);
                result.splice(resultKeyIndex, 1);
            }
            return result;
        }, keys2);

        return diff;
    }

    /**
     * get 32-bits hash value.
     *
     * @param data
     */
    public hash(data: any): string {
        data = data || '';
        data = typeof data === 'object' ? this.json(data, true) : data; //WARN! it must be sorted json.
        data = typeof data !== 'string' ? String(data) : data;
        /**
         * Calculate a 32 bit FNV-1a hash
         * Found here: https://gist.github.com/vaiorabbit/5657561
         * Ref.: http://isthe.com/chongo/tech/comp/fnv/
         *
         * @param {string} str the input value
         * @param {boolean} [asString=false] set to true to return the hash value as
         *     8-digit hex string instead of an integer
         * @param {integer} [seed] optionally pass the hash of the previous chunk
         * @returns {integer | string}
         */
        const hashFnv32a = function(str: any, asString?: any, seed?: any): string {
            /*jshint bitwise:false */
            let i, l;
            let hval = seed === undefined ? 0x811c9dc5 : seed;

            for (i = 0, l = str.length; i < l; i++) {
                hval ^= str.charCodeAt(i);
                hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
            }
            // Convert to 8 digit hex string
            return ('0000000' + (hval >>> 0).toString(16)).substr(-8);
        };
        return hashFnv32a(data, true);
    }

    //! start promise chain.
    public promise(param: any) {
        return new Promise(function(resolve) {
            resolve(param);
        });
    }

    //! promise in sequence.
    // example) promise_sequence([1,2,3], item => item+1);
    public promise_sequence(array: any, func: any) {
        let chain = this.promise(array.shift());
        chain = array.reduce(
            (chain: any, item: any) => {
                return chain.then(() => func(item));
            },
            chain.then(item => func(item)),
        );
        return chain;
    }

    /**
     * get md5 hash
     */
    public md5(data: any, digest: 'latin1' | 'hex' | 'base64') {
        digest = digest === undefined ? 'hex' : digest;
        return crypto
            .createHash('md5')
            .update(data)
            .digest(digest);
    }

    /**
     * get hmac hash
     */
    public hmac(data: any, KEY?: string, algorithm?: string, encoding?: 'latin1' | 'hex' | 'base64') {
        KEY = KEY || 'XENI';
        encoding = encoding || 'base64';
        algorithm = algorithm || 'sha256';
        return crypto
            .createHmac(algorithm, KEY)
            .update(data)
            .digest(encoding);
    }

    /**
     * parse query-string.
     *
     * @param query
     */
    public qs_parse(query: string) {
        const param: any = QUERY_STRING.parse(query);
        Object.keys(param).forEach(key => {
            if (false) {
            }
            //! 빈 파라미터의 값을 빈 문자열로 치환
            else if (param[key] === null) {
                param[key] = '';
            }
            //! 숫자로 된 문자열이 오면 숫자로 변환
            else if (/^[1-9][0-9]*$/.test(param[key])) {
                param[key] = this.N(param[key]);
            }
        });
        return param;
    }

    /**
     * stringify as querystring.
     * @param query
     */
    public qs_stringify(query: { [key: string]: any }) {
        const param = QUERY_STRING.stringify(query);
        return param;
    }

    /**
     * group as qs
     */
    public readonly qs = {
        /**
         * parse qs string
         */
        parse: (q: string) => this.qs_parse(q),
        /**
         * stringify qs object
         */
        stringify: (q: { [key: string]: any }) => this.qs_stringify(q),
    };

    /**
     * get crypto object.
     */
    public readonly crypto = (passwd: string, algorithm?: string) => {
        algorithm = algorithm || 'aes-256-ctr';
        const MAGIC = 'LM!#';
        return new (class {
            public encrypt = (val: string): string => {
                val = val === undefined ? null : val;
                // msg = msg && typeof msg == 'object' ? JSON_TAG+JSON.stringify(msg) : msg;
                //! 어느 데이터 타입이든 저장하기 위해서, object로 만든다음, 암호화 시킨다.
                const msg = JSON.stringify({ alg: algorithm, val: val });
                const buffer = Buffer.from(`${MAGIC}${msg || ''}`, 'utf8');
                // const key = Buffer.from(`${passwd || ''}`, 'utf8');
                const cipher = crypto.createCipher(algorithm, passwd);
                // const cipher = crypto.createCipheriv(algorithm, key, iv);
                const crypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
                return crypted.toString(1 ? 'base64' : 'utf8');
            };
            public decrypt = (msg: string): string => {
                const buffer = Buffer.from(`${msg || ''}`, 'base64');
                // const key = Buffer.from(`${passwd || ''}`, 'utf8');
                const decipher = crypto.createDecipher(algorithm, passwd);
                // const decipher = crypto.createDecipheriv(algorithm, key, iv);
                const dec = Buffer.concat([decipher.update(buffer), decipher.final()]).toString('utf8');
                if (!dec.startsWith(MAGIC)) throw new Error('400 INVALID PASSWD - invalid magic string!');
                const data = dec.substr(MAGIC.length);
                if (data && !data.startsWith('{') && !data.endsWith('}'))
                    throw new Error('400 INVALID PASSWD - invalid json string!');
                var $msg = JSON.parse(data) || {};
                return $msg.val;
            };
        })();
    };

    /**
     * get UUID as `uuid.v4()`
     */
    public uuid() {
        return uuid.v4();
    }
}
