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
import { $U } from '../../engine';
import { expect2 } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/shared';
import { LambdaHandler } from './lambda-handler';
import { LambdaSQSHandler } from './lambda-sqs-handler';
import * as $lambda from './lambda-handler.spec';
import * as $web from './lambda-web-handler.spec';

class LambdaSQSHandlerLocal extends LambdaSQSHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
    public getLastResult = () => this.$lastResult;
}
export const instance = () => {
    const { service: lambda } = $lambda.instance();
    const { service: web } = $web.instance(lambda);
    const service = new LambdaSQSHandlerLocal(lambda);
    return { lambda, service, web };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('LambdaSQSHandler', () => {
    //! protocol param
    it('should pass handle protocol with web (default)', async done => {
        /* eslint-disable prettier/prettier */
        const { lambda, service, web } = instance();
        const event: any = loadJsonSync('data/protocol.event.sqs.json');
        expect2(event.Records[0], 'messageId').toEqual({ messageId:'3649c307-b056-406c-b42a-d68493b8055e' });

        //! PRE-CONDITION
        expect2(() => web.result).toEqual(null);
        expect2(service.getLastResult()).toEqual(null);

        //! RUN
        const res = await lambda.handle(event, null);
        expect2(res).toEqual(undefined);

        //! POST-CONDITION.
        expect2(service.getLastResult()).toEqual(['404 NOT FOUND - GET /metrics/hello/test-protocol']);
        // expect2(service.getLastResult()).toEqual(['']);
        expect2(() => web.result).toEqual(null);

        /* eslint-enable prettier/prettier */
        done();
    });

    //! protocol param
    it('should pass handle protocol with web (hello)', async done => {
        /* eslint-disable prettier/prettier */
        const { lambda, service, web } = instance();
        const event: any = loadJsonSync('data/protocol.event.sqs.json');
        expect2(event.Records[0], 'messageId').toEqual({ messageId:'3649c307-b056-406c-b42a-d68493b8055e' });

        //! CHANGE PARAM
        const body = JSON.parse(event.Records[0].body);
        body.type = 'hello';                                // override to `hello` type.
        event.Records[0].body = JSON.stringify(body);

        //! PRE-CONDITION
        expect2(() => web.result).toEqual(null);
        expect2(service.getLastResult()).toEqual(null);

        //! RUN
        const res = await lambda.handle(event, null);
        expect2(res).toEqual(undefined);

        //! POST-CONDITION.
        const expected = { id: 'hello', cmd: 'test-protocol', hello: 'test-protocol hello' };
        expect2(service.getLastResult()).toEqual([$U.json(expected)]);
        expect2(() => web.result).toEqual({ ...expected });

        /* eslint-enable prettier/prettier */
        done();
    });
});
