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
import { CrendentialForAWS } from '../environ';
// import $engine from '../engine'; #WARN! DO NOT LOAD $engine here due to global initialization.
import { LemonEngine } from '../engine/types';
import { onlyDefined } from '../common/test-helper';
import { measure } from '../lib/perf';

/**
 * `@aws-sdk/credential-providers`, required on the first use (not at import; v5 B2-c, K6).
 */
let $credentialProviders: typeof import('@aws-sdk/credential-providers') = null;
// memoized sync loader; prints `PERF > lazy-load ...` only when an engine logger is given (`awsConfig`).
const loadCredentialProviders = ($engine?: LemonEngine): typeof import('@aws-sdk/credential-providers') => {
    if (!$credentialProviders) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const load = () => require('@aws-sdk/credential-providers');
        $credentialProviders =
            $engine?.inf && $engine?.U
                ? measure($engine.inf, $engine.U.NS('PERF', 'cyan'), 'lazy-load @aws-sdk/credential-providers', load)
                : load();
    }
    return $credentialProviders;
};

/**
 * type: `AwsCredentialProvider`
 * - the credentials provider (an async function) for the AWS SDK clients.
 * - local structural type (v5 B2-c): no AWS SDK type in the published `.d.ts`.
 * - not exported (no new root name); it shows in `.d.ts` through `AwsConfigParams.credentials`.
 */
type AwsCredentialProvider = (props?: Record<string, any>) => Promise<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    expiration?: Date;
}>;

/**
 * Check if the current environment is AWS Lambda
 * @returns {boolean} - true if running in AWS Lambda environment
 */
export const isLambda = (): boolean => {
    return !!process?.env?.AWS_LAMBDA_FUNCTION_NAME;
};

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
    //* no logger here: `PERF` is printed only when `awsConfig()` loads the package first.
    const provider = loadCredentialProviders().fromIni({ profile });
    const $res = await provider();
    return { ...$res, profile };
};

/**
 * type: `AwsConfigParams`
 * - parameters for AWS config.
 * - used for `awsConfig()`
 */
export interface AwsConfigParams {
    /** AWS region */
    region?: string;
    /** AWS profile */
    profile?: string; // AWS profile
    /** AWS credentials provider */
    credentials?: AwsCredentialProvider;
}

/**
 * load config for aws sdk
 * - if `profile` is not defined, use `AWS_PROFILE` or `default`
 * - if `region` is not defined, use `AWS_REGION` or `ap-northeast-2`
 *
 * ```
 * # run with default profile
 * $ npm run test:watch
 *
 * # run with `lemon` profile
 * #npm run test:watch.lemon
 */
export const awsConfig = <T extends AwsConfigParams>(
    $engine: LemonEngine,
    /** params or region */
    params?: T | string | (() => string),
): T & { credentials?: AwsCredentialProvider } => {
    const errScope = `awsConfig(${$engine?.id ?? ''})`;
    const region: string =
        params === undefined
            ? 'ap-northeast-2'
            : typeof params === 'string'
            ? params
            : typeof params === 'function'
            ? params()
            : params?.region;
    const _conf: T = typeof params === 'object' ? params : null;

    // If running in Lambda environment, set profile to 'none'
    const profile = isLambda() ? 'none' : ($engine?.environ('NAME', 'none') as string);
    if (typeof profile !== 'string')
        throw new Error(`@env.NAME[${typeof profile}] is invalid (check $engine) - ${errScope}`);

    //* build defualt config.
    const $conf = onlyDefined<T>({
        profile: profile && profile !== 'none' ? profile : undefined,
        region,
        ..._conf,
    });
    if (typeof $conf.region === 'string' && !$conf.region)
        throw new Error(`.region[${$conf.region}] is invalid (empty) - ${errScope}`);

    //! load the credentials provider(async function); the package is loaded only when a profile is set.
    const credentials: AwsCredentialProvider =
        typeof ($conf as any).credentials === 'function'
            ? ($conf as any).credentials
            : $conf.profile
            ? loadCredentialProviders($engine).fromIni({ profile: $conf.profile })
            : undefined;

    return onlyDefined({ ...$conf, credentials });
};
