/**
 * `tools/tools.ts`
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
import { fromIni } from '@aws-sdk/credential-providers';
import { CrendentialForAWS } from '../environ';

/**
 * load json in sync.
 */
export const loadJsonSync = <T extends object = any>(name: string, def = {}): T => {
    name = !name.startsWith('./') ? `./${name}` : name;
    try {
        const rawdata = fs.readFileSync(name);
        return JSON.parse(rawdata.toString()) as T;
    } catch (e) {
        if (def && typeof def === 'object') (def as any).error = `${e.message || e}`;
        return def as T;
    }
};

/**
 * load yml data via './data/<file>.yml'
 */
export const loadDataYml = <T extends object = any>(file: string, folder?: string): T => {
    folder = folder || 'data';
    const path = `./${folder}/` + file + (file.endsWith('.yml') ? '' : '.yml');
    if (!fs.existsSync(path)) throw new Error('404 NOT FOUND - data-file:' + path);
    return yaml.load(fs.readFileSync(path, 'utf8'));
};

/**
 * dynamic loading credentials by profile. (search PROFILE -> NAME)
 *
 * @returns {Promise<CrendentialForAWS>} - AWS credentials
 */
export const asyncCredentials = async (profile?: string): Promise<CrendentialForAWS> => {
    const provider = fromIni({ profile });
    const $res = await provider();
    return { ...$res, profile };
};
