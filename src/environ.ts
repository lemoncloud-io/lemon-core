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
 * loader `<profile>.yml`
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
 */
export const loadEnviron = (process: any, options?: EnvironmentSet): EnvironmentSet => {
    //TODO - use `lemon-devkit` to load environment from process.
    return;
};

/**
 * load AWS credential profile via env.NAME
 *
 * NOTE! ONLY FOR development purpose.
 *
 * ```sh
 * # load AWS 'lemon' profile, and run test.
 * $ NAME=lemon npm run test
 * ````
 * @param $proc     process (default `global.process`)
 * @param $info     info logger (default `console.info`)
 */
export const loadProfile = (
    $proc?: { env?: any },
    $info?: (title: string, msg?: string) => void,
): CrendentialForAWS => {
    const $env = $proc?.env || process.env;
    const profile = `${$env['NAME'] != 'none' ? $env['NAME'] || '' : ''}`;
    if (profile && $info) $info('! PROFILE =', profile);
    //TODO - use `lemon-devkit` to load credentials.
    const $res: CrendentialForAWS = credentials(profile);
    return { ...$res, profile };
};

/**
 * dynamic loading credentials by profile. (search PROFILE -> NAME)
 *
 * @deprecated use `asyncCredentials` instead.
 */
export const credentials = (profile: string): CrendentialForAWS => {
    if (!profile) return;
    throw new Error('WARN! credentials() is deprecated. use `asyncCredentials()` instead!');
    //TODO - use `lemon-devkit` to load credentials.
};

//* export default.
export default loadEnviron;
