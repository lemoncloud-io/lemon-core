/**
 * `lib/tools.ts`
 * - additional helper.
 *
 * ex:
 * ```ts
 * const environ = require('lemon-core/dist/environ').default;
 * const $env = environ(process)
 * ```
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-09 initial typescript version.
 * @date        2018-05-23 initial version
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright   (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import fs from 'fs';
import yaml from 'js-yaml';
import AWS from 'aws-sdk';

//! load json in sync.
export const loadJsonSync = (name: string, def: any = {}) => {
    name = !name.startsWith('./') ? `./${name}` : name;
    try {
        const rawdata = fs.readFileSync(name);
        return JSON.parse(rawdata.toString());
    } catch (e) {
        if (def) def.error = `${e.message || e}`;
        return def;
    }
};

//! dynamic loading credentials by profile. (search PROFILE -> NAME)
export const asyncCredentials = async (profile: string) =>
    new Promise((resolve, reject) => {
        let credentials: any = null;
        const callback = (e: Error, r?: any) => {
            // e || console.error('! credentials.res :=', r);
            // e && console.error('! credentials.err :=', e);
            if (e) reject(e);
            else resolve(r || credentials);
        };
        try {
            //WARN! - could not catch AWS.Error `Profile null not found` via callback.
            credentials = new AWS.SharedIniFileCredentials({ profile, callback });
            AWS.config.credentials = credentials;
        } catch (e) {
            callback(e);
        }
    });

//! dynamic loading credentials by profile. (search PROFILE -> NAME)
export const credentials = (profile: string): string => {
    if (!profile) return '';
    // console.info('! credentials.profile =', profile);
    // WARN! - could not catch AWS.Error `Profile null not found` via callback.
    const credentials = new AWS.SharedIniFileCredentials({ profile });
    AWS.config.credentials = credentials;
    return `${profile}`;
};

//! return whether AWS credentials set
export const hasCredentials = (): boolean => {
    return !!AWS.config.credentials;
};

//! load yml data via './data/<file>.yml'
export const loadDataYml = (file: string, folder?: string): any => {
    folder = folder || 'data';
    const path = `./${folder}/` + file + (file.endsWith('.yml') ? '' : '.yml');
    if (!fs.existsSync(path)) throw new Error('404 NOT FOUND - data-file:' + path);
    return yaml.safeLoad(fs.readFileSync(path, 'utf8'));
};

interface AdaptiveParam<T> {
    (name: string, defval: T, argv?: string[]): T;
}
// get running parameter like -h api.
export const getRunParam: AdaptiveParam<boolean | number | string | object> = (o, defval, argv?) => {
    // export function getRunParam<U extends boolean | number | string | object>(o: string, defval: U, argv?: string[]): U {
    // eslint-disable-next-line no-param-reassign
    argv = argv || process.argv || []; // use scope.
    const nm = `-${o}`;
    let i = argv.indexOf(nm);
    i = i > 0 ? i : argv.indexOf(o);
    i = i >= 0 ? i : argv.indexOf(`-${nm}`); // lookup -o => --o.
    if (i >= 0) {
        const val = argv[i + 1];
        if (typeof defval === 'boolean') {
            // transform to boolean.
            return val === 'true' || val === 't' || val === 'y' || val === '1';
        } else if (typeof defval === 'number') {
            // convert to integer.
            return Math.round(Number(val) / 1);
        } else if (typeof defval === 'object') {
            // array or object
            if ((val.startsWith('[') && val.endsWith(']')) || (val.startsWith('{') && val.endsWith('}')))
                return JSON.parse(val);
            else if (Array.isArray(defval)) return `${val}`.split(', ');
            else return { value: val };
        }
        return val;
    }
    return defval;
};
