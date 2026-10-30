/**
 * `model.spec.ts`
 * - spec for the sub-path `lemon-core/model` (v5 B16, D73): the whole lemon-model surface through lemon-core.
 * - T-01..T-06: same objects as lemon-model, types compile, the root stays at the 32 v4 names (S-06),
 *   `exports['./model']`, the exact lemon-model pin, and the ESM wrapper / smoke lists.
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2026-10-30 v5 B16: initial version.
 *
 * @copyright (C) lemoncloud.io 2026 - All Rights Reserved.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as $lm from 'lemon-model';
import * as $model from './model';
import * as $root from './index';
import { CoreModel } from './model';
import type { NextIdentity, NextContext } from './model';

//* v5 B16: package root (one level above `src/`).
const ROOT = path.resolve(__dirname, '..');
//* v5 B16: read a file of the package root as text.
const readText = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');
//* v5 B16: this package's `package.json`.
const $pack = JSON.parse(readText('package.json'));

//! main test body.
describe('lemon-core/model (v5 B16)', () => {
    //* v5 B16 T-01: the sub-path gives the same objects as lemon-model.
    it('B16 T-01 ./model exposes field, fieldsOf, specsOf, FIELDS_KEY, CoreModel === lemon-model', () => {
        const names = ['field', 'fieldsOf', 'specsOf', 'FIELDS_KEY', 'CoreModel'] as const;
        names.forEach(n => {
            expect(($model as any)[n]).toBeDefined();
            expect(($model as any)[n]).toBe(($lm as any)[n]);
        });
        //* every lemon-model value name is also on the sub-path.
        const missing = Object.keys($lm).filter(k => !(k in $model));
        expect(missing).toEqual([]);
    });

    //* v5 B16 T-02: lemon-model types compile from the sub-path, and `CoreModel` is the lemon-model class.
    it('B16 T-02 types NextIdentity/NextContext compile; CoreModel instanceof lemon-model CoreModel', () => {
        const identity: NextIdentity = { sid: 's1', uid: 'u1', gid: 'g1' };
        const context: NextContext = { identity, source: 'B16' };
        expect(context.identity.uid).toBe('u1');
        const model = new CoreModel();
        expect(model instanceof $lm.CoreModel).toBe(true);
        expect(CoreModel).toBe($lm.CoreModel);
    });

    //* v5 B16 T-03: the root surface is unchanged (S-06 boundary).
    it('B16 T-03 root keeps the S-06 boundary: no field/fieldsOf/specsOf/FIELDS_KEY, has CoreModel/AbstractTransformer/CORE_FIELDS', () => {
        const keys = Object.keys($root);
        ['field', 'fieldsOf', 'specsOf', 'FIELDS_KEY'].forEach(n => expect(keys).not.toContain(n));
        ['CoreModel', 'AbstractTransformer', 'CORE_FIELDS'].forEach(n => expect(keys).toContain(n));
        //* root and sub-path give one `CoreModel` class.
        expect(($root as any).CoreModel).toBe($model.CoreModel);
    });

    //* v5 B16 T-04: the `exports` map declares `./model` with 4 conditions.
    it('B16 T-04 package.json exports["./model"] has types/import/require/default', () => {
        expect($pack.exports['./model']).toEqual({
            types: './dist/model.d.ts',
            import: './dist/esm/model.mjs',
            require: './dist/model.js',
            default: './dist/model.js',
        });
    });

    //* v5 B16 T-05: lemon-model is pinned to one exact version, the installed one (the pair).
    it('B16 T-05 dependencies["lemon-model"] is an exact version equal to the installed lemon-model', () => {
        const pin: string = $pack.dependencies['lemon-model'];
        expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
        const installed = JSON.parse(readText('node_modules/lemon-model/package.json')).version;
        expect(pin).toBe(installed);
    });

    //* v5 B16 T-06: the ESM wrapper and the ESM smoke list the sub-path (a removal fails here).
    it('B16 T-06 gen-esm-wrapper lists dist/esm/model.mjs; esm-smoke lists lemon-core/model', () => {
        expect(readText('scripts/gen-esm-wrapper.cjs')).toContain("out: 'dist/esm/model.mjs'");
        expect(readText('scripts/esm-smoke.mjs')).toContain("'lemon-core/model'");
    });
});
