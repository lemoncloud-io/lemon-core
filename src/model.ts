/**
 * `model.ts`
 * - sub-path `lemon-core/model`: the whole lemon-model surface, through lemon-core (v5 B16, D73).
 * - consumers do not declare `lemon-model` themselves: the lemon-core version fixes the lemon-model version.
 * - the root (`lemon-core`) keeps only the 32 v4 lemon-model names (S-06); every other name is here.
 *
 * usage:
 * ```ts
 * import { CoreModel } from 'lemon-core'; // root: the 32 v4 names
 * import { field, fieldsOf } from 'lemon-core/model'; // everything else of lemon-model
 * ```
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B16: initial version (`export *` from lemon-model, no default export there).
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
//* v5 B16: re-export every named value and type of lemon-model (lemon-model has no default export).
export * from 'lemon-model';
