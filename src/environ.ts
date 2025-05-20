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
import { AwsCredentialIdentity } from '@aws-sdk/types';

export interface CrendentialForDev extends AwsCredentialIdentity {
    /** the loaded profile name if applicable */
    profile?: string;
}

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
): CrendentialForDev => {
    const $env = $proc?.env || process.env;
    const profile = `${$env['NAME'] != 'none' ? $env['NAME'] || '' : ''}`;
    if (profile && $info) $info('! PROFILE =', profile);
    //TODO - use `lemon-devkit` to load credentials.
    const $res: AwsCredentialIdentity = {} as any;
    return { ...$res, profile };
};

/**
 * dynamic loading credentials by profile. (search PROFILE -> NAME)
 *
 * @deprecated use `asyncCredentials` instead.
 */
export const credentials = (profile: string): CrendentialForDev => {
    if (!profile) return;
    throw new Error('WARN! credentials() is deprecated. use `asyncCredentials()` instead!');
    //TODO - use `lemon-devkit` to load credentials.
};
