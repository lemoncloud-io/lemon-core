/**
 * `index.ts`
 * - main index
 *
 * **NOTE**
 * - override `process.env` before use(or import) this.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-08-09 initial commit
 * @date        2019-11-26 cleanup and optimized for `lemon-core#v2`
 * @date        2026-10-30 export `$localTransport` and `LocalDelivery` (opt-in local transport, `LOCAL_TRANSPORT=mock`).
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//NOTE! - if loading this index.ts, it will trigger `bootloader` in `/engine`.
export * from './common/types';
export * from './common/test-helper';
export { LemonError } from './common/lemon-error'; //* v5 B5: the only new root name (status-carrying error, SPEC § 6.6)
export { $localTransport } from './cores/protocol/local-transport'; //* opt-in local transport (mock delivery in local mode)
export type { LocalDelivery } from './cores/protocol/local-transport';
export * from './engine/';
export * from './cores/';
export * from './tools/';
export * from './controllers/';

//* init an instance of core modules.
import engine from './engine/';
import cores from './cores/';
import { $U, _inf } from './engine/';

//* export as group.
import * as lib from './lib/';
import * as tools from './tools/';
import * as controllers from './controllers/';

//* export as named, or helpers.
export { lib, tools };
export * from './helpers/';
export * from './extended/';

//* export the L2 template layer. v5 B3: every L1/L2 name has one definition, so no collision pins are needed.
export * from './extended/cores/';
export { withBrowserCache } from './extended/cores/browser-cache'; //* not in the cores barrel (optional util)
export { $ES6Routed } from './extended/cores/abstract-services'; //* v5 B2-b: the same lazy object as `$OS2` (root `$ES6` is removed)

//* export as default.
export default { engine, cores, tools, controllers };

//* PERF (D40): process time at the end of this barrel (the baseline to compare the lazy loads against).
_inf($U.NS('PERF', 'cyan'), '>', 'loaded lemon-core', `${(process.uptime() * 1000).toFixed(1)} ms`);
