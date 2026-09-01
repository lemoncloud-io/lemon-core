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

//* init an instance of core modules.
import engine from './engine/';
import cores from './cores/';

//* export as group.
import * as lib from './lib/';
import * as tools from './tools/';
import * as controllers from './controllers/';

//* export as named, or helpers.
export { lib, tools };
export * from './helpers/';
export * from './extended/';

//* export the L2 template layer. explicit lines below pin the name collisions with L1:
export * from './extended/cores/';
export { $T } from './extended/cores/commons'; //* L2 wins — 4.2.x semantics (`asLut`/`BN`/`asMeta`, `S2` trims)
export { onlyDefined } from './common/test-helper'; //* L1 wins — signature compat (`(N, $def)`)
export { sourceToItem, $ES6 } from './extended/abstract-service'; //* L1 wins — keep existing behavior
export { withBrowserCache } from './extended/cores/browser-cache'; //* not in the cores barrel (optional util)
export { $ES6Routed } from './extended/cores/abstract-services'; //* explicit name only — root `$ES6` above must stay non-OS2 (decision #3); prevents silent search-backend swap

//* decision #4 (cores-migration P1): `helpers/types.ts` (L1) and `extended/cores/types.ts` (L2)
//* redefine the same ~10 type names (`export *` collisions raise TS2308 here without these pins).
//* `extended/cores/types.ts` wins for all of them — it is already a superset: its `IdentityToken`
//* carries `cid`/`did` which `helpers/types.ts` never had (no merge needed, contrary to the
//* original plan's premise — verified by direct inspection, see cores-migration README §7).
export type {
    IdentityToken,
    IdentityTokenSite,
    IdentityTokenUser,
    IdentityTokenGroup,
    ListResult,
    PaginatedListResult,
    AggrKeyCount,
    ListParam,
    PaginateParam,
    BulkUpdateBody,
    BulkBody,
    BodyList,
    BulkItemsResult,
} from './extended/cores/types';
//* same L2-wins rationale as `$T` above — these call the same underlying parsing, duplicated verbatim.
export { parseListParam, parsePaginateParam } from './extended/cores/commons';

//* export as default.
export default { engine, cores, tools, controllers };
