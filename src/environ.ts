/**
 * `environ.ts`
 * - override environ with `env/<profile>.yml`
 * - **NOTE** seperated file from index due to initialization sequence.
 *
 * usage (javascript):
 * ```js
 * const environ = require('lemon-core/dist/environ').default;
 * process.env = environ(process)
 * ```
 *
 * usage (typescript):
 * ```ts
 * import environ from 'lemon-core/dist/environ';
 * const $env = environ(process);
 * process.env = $env;
 * ```
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-09 initial typescript version.
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 *
 * @copyright   (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import fs from 'fs';
import * as yaml from 'js-yaml';
import AWS from 'aws-sdk';

interface Options {
    ENV?: string;
    STAGE?: string;
    ENV_PATH?: string;
}

/**
 * loader `<profile>.yml`
 *
 * **Determine Environ Target**
 * 1. ENV 로부터, 로딩할 `env.yml` 파일을 지정함.
 * 2. STAGE 로부터, `env.yml`내 로딩할 환경 그룹을 지정함.
 *
 * example:
 * `$ ENV=lemon STAGE=dev nodemon express.js --port 8081`
 *
 * @param process
 * @param param1
 */
export const loadEnviron = (process: any, options?: Options) => {
    options = options || {};
    let { ENV, STAGE, ENV_PATH } = options;
    const $env = (process && process.env) || {};
    const QUIET = 0 ? 0 : $env['LS'] === '1'; // LOG SILENT - PRINT NO LOG MESSAGE
    const PROFILE = ENV || $env['PROFILE'] || $env['ENV'] || 'none'; // Environment Profile Name.
    STAGE = STAGE || $env['STAGE'] || $env['NODE_ENV'] || 'local'; // Global STAGE/NODE_ENV For selecting.
    const _log = QUIET ? (...a: any) => {} : console.log;
    _log(`! PROFILE=${PROFILE} STAGE=${STAGE}`);

    //! initialize environment via 'env.yml'
    return ($det => {
        const file = PROFILE;
        const path = `${ENV_PATH || './env'}/` + file + (file.endsWith('.yml') ? '' : '.yml');
        if (!fs.existsSync(path)) throw new Error('FILE NOT FOUND:' + path);
        _log(`! loading yml-file: "${path}"`);
        const $doc: any = yaml.safeLoad(fs.readFileSync(path, 'utf8'));
        const $src: any = ($doc && $doc[STAGE]) || {};
        const $new = Object.keys($src).reduce(($O: any, key: string) => {
            const val = $src[key];
            if (typeof val == 'string' && val.startsWith('!')) {
                //! force to update environ.
                $O[key] = val.substring(1);
            } else if (typeof val == 'object' && Array.isArray(val)) {
                //! join array with ', '.
                $O[key] = val.join(', ');
            } else if ($det[key] === undefined) {
                //! override only if undefined.
                $O[key] = `${val}`; // as string.
            } else {
                //! ignore!.
            }
            return $O;
        }, {});
        //! make sure STAGE.
        $new.STAGE = $new.STAGE || STAGE;
        return Object.assign($det, $new);
    })($env);
};

/**
 * dynamic loading credentials by profile. (search PROFILE -> NAME)
 * !WARN! - could not catch AWS.Error `Profile null not found` via callback.
 *
 * @param profile   profile name of AWS.
 */
const credentials = (profile: string): string => {
    if (!profile) return '';
    const credentials = new AWS.SharedIniFileCredentials({ profile });
    AWS.config.credentials = credentials;
    return `${profile}`;
};

/**
 * load AWS credential profile via env.NAME
 *
 * ```sh
 * # load AWS 'lemon' profile, and run test.
 * $ NAME=lemon npm run test
 * ````
 * @param $proc     process (default `global.process`)
 * @param $info     info logger (default `console.info`)
 */
export const loadProfile = ($proc?: { env?: any }, $info?: (title: string, msg?: string) => void) => {
    $proc = $proc === undefined ? process : $proc;
    $info = $info === undefined ? console.info : $info;
    const $env = loadEnviron($proc);
    const PROFILE = `${$env['NAME'] != 'none' ? $env['NAME'] || '' : ''}`;
    if (PROFILE && $info) $info('! PROFILE =', PROFILE);
    return credentials(PROFILE);
};

//! export default.
export default loadEnviron;
