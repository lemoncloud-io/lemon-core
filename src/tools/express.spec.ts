/**
 * `tools/express.spec.ts`
 * - test runnder for `tools/express.ts`
 *
 *
 * @author      Steve <steve@lemoncloud.io>
 * @date        2019-11-26 initial unit test.
 * @date        2025-05-20 cleanup `express` out of this module.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { expect2 } from '../common/test-helper';
import { buildExpress } from './express';

//! main test body.
describe('express', () => {
    it('should pass buildExpress()', async () => {
        expect2(() => buildExpress(null, null)).toEqual();
    });
});
