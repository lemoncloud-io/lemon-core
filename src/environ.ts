/**
 * `environ.ts`
 * - override environ with `env/<profile>.yml`
 * - **NOTE** seperated file from index due to initialization sequence.
 *
 * ex:
 * ```ts
 * const environ = require('lemon-core/dist/environ').default;
 * const $env = environ(process)
 * ```
 *
 * @author       Steve Jung <steve@lemoncloud.io>
 * @date         2019-08-09 initial typescript version.
 *
 * @copyright   (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import fs from 'fs';
import * as yaml from 'js-yaml';

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
    const QUIET = $env['LS'] === '1'; // LOG SILENT - PRINT NO LOG MESSAGE
    ENV = ENV || $env['ENV'] || 'none.yml'; // Environment file.
    STAGE = STAGE || $env['STAGE'] || $env['NODE_ENV'] || 'local'; // Global STAGE/NODE_ENV For selecting.
    const _log = QUIET ? (...args: any[]) => {} : console.log;
    _log(`! ENV =${ENV} STAGE=${STAGE}`);

    //! initialize environment via 'env.yml'
    return ($det => {
        const file = ENV;
        const path = `${ENV_PATH || './env'}/` + file + (file.endsWith('.yml') ? '' : '.yml');
        if (!fs.existsSync(path)) throw new Error('FILE NOT FOUND:' + path);
        _log(`! loading yml-file: "${path}"`);
        const $doc = yaml.safeLoad(fs.readFileSync(path, 'utf8'));
        const $src = ($doc && $doc[STAGE]) || {};
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

//! export default.
export default loadEnviron;
