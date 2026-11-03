/**
 * fixture of `bin/lib/fields-types.test.mjs`: dummy models with known type conflicts.
 * - not compiled or run; `bin/lib/fields-types.mjs` only reads the declared types.
 * - known conflicts (deep 2): hard `error`, `hidden`, `owner$`; order `count`, `kind`, `owner$.id`, `tags`.
 */
import { CoreModel, field, fieldsOf } from 'lemon-model';

// stand-ins for the field-list helpers of a service (`keys<T>()`, `fieldKeys.x<T>()`, `filterFields()`).
declare function keys<T>(): (keyof T & string)[];
declare const fieldKeys: { [k: string]: <T>() => (keyof T & string)[] };
const filterFields = (f: string[]) => f;

// a 0/1 flag (a number in the index).
type BoolFlag = 0 | 1;

// a small nested object.
interface Head {
    id?: string;
    name?: string;
}

// `count` number, `hidden` number, `owner$` object, `tags` string, `at` date.
export interface AModel extends CoreModel<'a'> {
    count?: number;
    hidden?: BoolFlag;
    owner$?: Head;
    tags?: string[];
    at?: Date;
}

// `count` string, `hidden` boolean, `owner$` string, `tags` number.
export interface BModel extends CoreModel<'b'> {
    count?: string;
    hidden?: boolean;
    owner$?: string;
    tags?: number[];
}

// `owner$.id` number, `error` object (CoreModel has `error?: string`), `kind` string (literal union with null).
export interface CModel extends CoreModel<'c'> {
    owner$?: { id?: number };
    error?: { code: number };
    kind?: 'x' | 'y' | null;
}

// a decorated class: `count` string (literal union), `kind` number (literal union).
export class DModel extends CoreModel<'d'> {
    @field() count?: 'one' | 'two';
    @field() kind?: 1 | 2;
}

// normalization only (no name shared with the others): nullish, index signature, mixed, any.
export interface EModel extends CoreModel<'e'> {
    size?: number | null;
    labels?: { [k: string]: number };
    either?: string | number;
    loose?: any;
}

// a CoreModel-shaped view that is not in `$FIELD` (only `--models RH` checks it): `size` string.
export interface EView extends CoreModel<'e'> {
    size?: string;
}

// the stored models (rule R).
export const $FIELD = {
    a: filterFields(keys<AModel>()),
    b: filterFields(fieldKeys.bModel<BModel>()),
    c: filterFields(fieldKeys.cModel<CModel>()),
    d: filterFields(fieldsOf(DModel)),
    e: filterFields(keys<EModel>()),
};
