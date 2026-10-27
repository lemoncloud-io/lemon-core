/**
 * `commons.ts`
 * - common tools to export.
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2022-11-01 optimized w/ `commons`
 * @date        2024-06-24 optimized `parseListParam()`
 * @date        2025-01-03 optimized `parseListParam()` w/ `offset`
 * @date        2025-05-25 optimized `$T.N()` + `parsePaginateParam()` w/ `noLimit` option
 * @date        2025-07-31 optimized `$T.B()` for boolean conversion.
 * @date        2026-02-09 optimized `$T.F()` to keep the original function.
 * @date        2026-04-10 optimized `types` to fix ts warning.
 * @date        2026-10-28 v5 B3: re-exports only — each name has one definition below `extended/cores`.
 *
 * @copyright   (C) 2022 LemonCloud Co Ltd. - All Rights Reserved.
 * @origin      `@lemoncloud/lemon-templates-api/cores`
 */
//* v5 B3: the single `$T` (32 members) lives in `helpers/helpers.ts`; re-exported to keep the L2 barrel and deep path.
export { $T } from '../../helpers/';
//* v5 B3: the parsers were verbatim copies of the `helpers/helpers.ts` ones; re-exported for the same reason.
export { parseListParam, parsePaginateParam } from '../../helpers/';
//* v5 B3: the copy was text-identical to the test-helper one (the root already used that); re-exported.
export { onlyDefined } from '../../common/test-helper';
