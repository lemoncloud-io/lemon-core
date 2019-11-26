/**
 * `lambda-sqs-handler.spec.ts`
 * - unit test for `lambda-sqs-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
// import { _it } from '../common/test-helper';

import * as $lambda from './lambda-handler.spec';
import { LambdaSQSHandler } from './lambda-sqs-handler';
import { LambdaHandler } from './lambda-handler';

class LambdaSQSHandlerLocal extends LambdaSQSHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
}
export const $sqs = () => {
    const { service: lambda } = $lambda.instance();
    const instance = new LambdaSQSHandlerLocal(lambda);
    return { lambda, instance };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('LambdaSQSHandler', () => {
    //! list in web-handler
    it('should pass success GET / via web', async done => {
        /* eslint-disable prettier/prettier */
        // const { lambda, instance } = $sqs();
        /* eslint-enable prettier/prettier */
        done();
    });
});
