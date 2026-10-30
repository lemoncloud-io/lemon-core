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
 * @date        2026-10-31 v5 B20: `loadEnviron()`/`loadProfile()` live here again (no `lemon-devkit`, D80).
 *
 * @copyright   (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import fs from 'fs';
import yaml from 'js-yaml';

/**
 * type: `CrendentialForAWS`
 * - common interface for AWS credentials.
 * - used for `AWS.config.credentials` or `AWS.Credentials`
 */
export interface CrendentialForAWS {
    /**
     * AWS access key ID
     */
    readonly accessKeyId: string;
    /**
     * AWS secret access key
     */
    readonly secretAccessKey: string;
    /**
     * A security or session token to use with these credentials. Usually
     * present for temporary credentials.
     */
    readonly sessionToken?: string;

    /** (optional) the loaded profile name if applicable */
    readonly profile?: string;
}

/**
 * type: `EnvironmentSet`
 * - common interface for environment variables.
 */
export interface EnvironmentSet {
    [key: string]: string;
    ENV?: string;
    STAGE?: string;
    ENV_PATH?: string;
}

/**
 * (only for dev) loader `<profile>.yml`
 *
 * **Determine Environ Target**
 * 1. ENV 로부터, 로딩할 `env.yml` 파일을 지정함.
 * 2. STAGE 로부터, `env.yml`내 로딩할 환경 그룹을 지정함.
 *
 * example:
 * `$ ENV=lemon STAGE=dev nodemon express.js --port 8081`
 *
 * - file: `${ENV_PATH || './env'}/${ENV || PROFILE || ENV || 'none'}.yml` (missing → `FILE NOT FOUND:<path>`).
 * - group: `STAGE || NODE_ENV || 'local'` in the file (unknown group → nothing).
 * - merge into `process.env` in place: `!value` overwrites (without `!`), an array overwrites as `a, b`,
 *   others only if the key is undefined (as string, `null` → `''`). `STAGE` is set if missing. `LS=1` silences logs.
 *
 * @param process the main process instance.
 * @param options (optional) default option.
 */
export const loadEnviron = (process?: any, options?: EnvironmentSet): EnvironmentSet => {
    //* v5 B20: ported from `lemon-devkit` (same rules), so no dev dependency is needed (D80).
    options = options || {};
    const { ENV, ENV_PATH } = options;
    const $env: EnvironmentSet = (process && process.env) || {};
    const QUIET = $env['LS'] === '1'; // LOG SILENT - PRINT NO LOG MESSAGE
    const PROFILE = ENV || $env['PROFILE'] || $env['ENV'] || 'none'; // Environment Profile Name.
    const STAGE = options?.STAGE || $env['STAGE'] || $env['NODE_ENV'] || 'local'; // Global STAGE/NODE_ENV For selecting.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _log = QUIET ? (...a: any[]) => {} : console.log;
    const isLocal = STAGE === 'local';
    if (!isLocal) _log(`! PROFILE=${PROFILE} STAGE=${STAGE}`);

    //* v5 B20: read the yml file, and take the group of `STAGE`.
    const file = PROFILE;
    const path = `${ENV_PATH || './env'}/` + file + (file.endsWith('.yml') ? '' : '.yml');
    if (!fs.existsSync(path)) throw new Error('FILE NOT FOUND:' + path);
    if (!isLocal) _log(`! loading yml-file: "${path}"`);
    const $doc: any = yaml.load(fs.readFileSync(path, 'utf8'));
    const $src: any = ($doc && $doc[STAGE]) || {};

    //* v5 B20: build the new values by the merge rules.
    const $new = Object.keys($src).reduce(($O: EnvironmentSet, key: string) => {
        const val = $src[key];
        if (typeof val == 'string' && val.startsWith('!')) {
            //* force to update environ.
            $O[key] = val.substring(1);
        } else if (typeof val == 'object' && Array.isArray(val)) {
            //* join array with ', '.
            $O[key] = val.join(', ');
        } else if ($env[key] === undefined) {
            //* override only if undefined.
            $O[key] = `${val ?? ''}`; // as string.
        }
        return $O;
    }, {});
    //* make sure STAGE.
    $new.STAGE = $new.STAGE || STAGE;
    return Object.assign($env, $new);
};

/**
 * (only for dev) load AWS credential profile via `env.NAME`
 *
 * NOTE! ONLY FOR development purpose.
 *
 * ```sh
 * # load AWS 'lemon' profile, and run test.
 * $ NAME=lemon npm run test
 * ````
 * @param $proc     process (default `global.process`)
 * @param options   (optional) parameters: `info` the logger of `! PROFILE =` (default `console.info`).
 * @returns {string} - profile name defiend as NAME in environ. (but, `none` is ignored)
 */
export const loadProfile = ($proc?: { env?: any }, options?: any): string => {
    //* v5 B20: ported from `lemon-devkit` → `loadEnviron()` of `$proc`, then `NAME` (`none` → '').
    $proc = $proc === undefined ? global.process : $proc;
    const $info = options?.info === undefined ? console.info : options.info;
    const $env = loadEnviron($proc);
    const NAME = $env?.['NAME'] ?? '';
    const PROFILE = `${NAME !== 'none' ? NAME : ''}`; // ignore 'none'.
    if (PROFILE && typeof $info === 'function') $info('! PROFILE =', PROFILE);
    return PROFILE;
};

//* export default.
export default loadEnviron;
