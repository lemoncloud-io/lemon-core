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
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
//NOTE! - if loading this index.ts, it will trigger `bootloader` in `/engine`.
export * from './common/types';
export * from './common/test-helper';
export * from './engine/';
export * from './cores/';
export * from './tools/';
export * from './controllers/';

//! import core modules.
import engine from './engine/';
import cores from './cores/';

import * as lib from './lib/';
import * as tools from './tools/';
import * as controllers from './controllers/';

//! export as named.
export { lib, tools };

//! export as default.
export default { engine, cores, tools, controllers };
