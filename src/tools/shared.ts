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
 * @author       Steve Jung <steve@lemoncloud.io>
 * @date         2019-08-09 initial typescript version.
 *
 * @copyright   (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import fs from 'fs';

//! load json in sync.
export const loadJsonSync = (name: string) => {
    name = !name.startsWith('./') ? `./${name}` : name;
    const rawdata = fs.readFileSync(name);
    return JSON.parse(rawdata.toString());
};

// get running parameter like -h api.
export const getRunParam = (o: string, defval: boolean | number | string, argv?: any) => {
    // eslint-disable-next-line no-param-reassign
    argv = argv || process.argv || []; // use scope.
    const nm = `-${o}`;
    let i = argv.indexOf(nm);
    i = i > 0 ? i : argv.indexOf(o);
    if (i >= 0) {
        const ret = argv[i + 1];
        //! decode param.
        if (typeof defval === 'boolean') {
            return ret === 'true' || ret === 't' || ret === 'y' || ret === '1';
        }
        if (typeof defval === 'number') {
            return Math.round(ret / 1);
        }
        return ret;
    }
    return defval;
};
