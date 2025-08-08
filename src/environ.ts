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
import { GETERR } from './common/test-helper';

/**
 * (internal) load module.
 */
const _load = <T = any>(mod: string): T => {
    try {
        return require(mod);
    } catch (e) {
        const error = `${e?.message ?? GETERR(e)}`.toLowerCase();
        if (error.includes('cannot find module')) return null;
        throw e;
    }
};

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
 * @param process the main process instance.
 * @param options (optional) default option.
 *
 * @deprecated use `loadEnviron()` from `lemon-devkit` instead.
 */
export const loadEnviron = (process?: any, options?: EnvironmentSet): EnvironmentSet => {
    const errScope = 'loadEnviron()';
    const devkit = _load('lemon-devkit');
    if (!devkit?.loadEnviron)
        throw new Error(`loadEnviron(function) is required (npm i -D lemon-devkit) - ${errScope}`);

    return devkit.loadEnviron(process, options);
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
 * @param options   (optional) parameters.
 * @returns {string} - profile name defiend as NAME in environ. (but, `none` is ignored)
 */
export const loadProfile = ($proc?: { env?: any }, options?: any): string => {
    const errScope = 'loadProfile()';
    const devkit = _load('lemon-devkit');
    if (!devkit?.loadProfile)
        throw new Error(`loadProfile(function) is required (npm i -D lemon-devkit) - ${errScope}`);
    try {
        return devkit.loadProfile($proc, options);
    } catch (e) {
        const error = `${e?.message ?? GETERR(e)}`.toLowerCase();
        if (error.includes('could not resolve credentials') && error.includes('[default]')) return '';
        throw e;
    }
};

/**
 * (only for dev) dynamic loading credentials by profile. (search PROFILE -> NAME)
 *
 * @deprecated use `asyncCredentials` instead.
 */
export const credentials = (profile: string): CrendentialForAWS => {
    if (!profile) return;
    throw new Error('WARN! credentials() is deprecated. use `asyncCredentials()` from lemon-devkit instead!');
};

//* export default.
export default loadEnviron;
