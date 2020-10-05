/**
 * `lambda-cron-handler.spec.ts`
 * - unit test for `lambda-cron-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2 } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaCronHandler } from './lambda-cron-handler';
import { LambdaHandler } from './lambda-handler';
import * as $lambda from './lambda-handler.spec';

class LambdaCronHandlerLocal extends LambdaCronHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
}
export const instance = () => {
    const { service: lambda } = $lambda.instance();
    const service = new LambdaCronHandlerLocal(lambda);
    return { lambda, service };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('LambdaCronHandler', () => {
    //! list in web-handler
    it('should pass handler listener', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();
        const event: any = loadJsonSync('data/sample.event.cron.json');
        event.cron.name = 'hello';      // override name.
        let data: any;
        service.addListener(async (id, param, body, context) => {
            data = { id, param, body, context };
        })
        const res = await service.handle(event, null);
        expect2(res).toEqual(undefined);
        expect2(data, 'id').toEqual({ id:'!' })
        expect2(data, 'param').toEqual({ param:{ name:'hello' } })
        expect2(data, 'body,context').toEqual({ body:null, context:null })
        /* eslint-enable prettier/prettier */
        done();
    });
});
