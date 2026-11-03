/**
 * `model-fields.ts`
 * - field list of a model manager: a `string[]` as is, or a model class read by `fieldsOf()` (lemon-model).
 * - v5 B4: not in the storage barrel, so these names stay off the package root (deep path only).
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-28 initial version (lemon-core v5 B4)
 *
 * @copyright (C) 2026 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { fieldsOf } from 'lemon-model';

/** a model class whose fields carry `@field()` annotations (ex: `class MyModel extends CoreModel<'my'>`) */
export type ModelClass = new (...args: any[]) => object;

/**
 * resolve the field names given to a manager.
 * @param fields    list of field names (returned as is), or a model class (`fieldsOf(cls)`)
 */
export const resolveFields = (fields: string[] | ModelClass): string[] =>
    typeof fields === 'function' ? fieldsOf(fields) : fields;
