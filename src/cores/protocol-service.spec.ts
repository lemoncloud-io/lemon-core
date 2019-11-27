/**
 * `protocol-service.spec.ts`
 * - unit test for `protocol-service`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-27 initial version.
 *
 * @copyright (C) lemoncloud.io 2019 - All Rights Reserved.
 */
import { $engine, _log, _inf, _err, $U } from '../engine/';
import { expect2, _it } from '../common/test-helper';
import { credentials } from '../tools/';

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('ProtocolService', () => {
    const PROFILE = 0 ? 'lemon' : '';
    if (PROFILE) credentials(PROFILE);

    //! dummy storage service.
    it('should pass basic protocol', async done => {
        /* eslint-disable prettier/prettier */
        expect2(()=>{ throw new Error('HI Error') }).toBe('HI Error');
        /* eslint-enable prettier/prettier */
        done();
    });
});
