/**
 * `lambda-sns-handler.spec.ts`
 * - unit test for `lambda-sns-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { $U } from '../../engine';
import { expect2 } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from './lambda-handler';
import { LambdaSNSHandler } from './lambda-sns-handler';
import * as $lambda from './lambda-handler.spec';
import * as $web from './lambda-web-handler.spec';

class LambdaSNSHandlerLocal extends LambdaSNSHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
    public getLastResult = () => this.$lastResult;
}
export const instance = () => {
    const { service: lambda } = $lambda.instance();
    const { service: web } = $web.instance(lambda);
    const service = new LambdaSNSHandlerLocal(lambda);
    return { lambda, service, web };
};

//! main test body.
describe('LambdaSNSHandler', () => {
    //* protocol param
    it('should pass handle protocol with web (default)', async () => {
        const { lambda, service, web } = instance();
        const event: any = loadJsonSync('data/samples/events/protocol.event.sns.json');
        expect2(() => event.Records[0].Sns, 'MessageId').toEqual({ MessageId: '7820a87c-f73c-5c88-b2be-fe250be6b564' });

        //* PRE-CONDITION
        expect2(() => web.result).toEqual(null);
        expect2(service.getLastResult()).toEqual(null);

        //* RUN
        const res = await lambda.handle(event, null);
        expect2(res).toEqual(undefined);

        //* POST-CONDITION.
        expect2(service.getLastResult()).toEqual(['404 NOT FOUND - GET /metrics/hello/test-protocol']);
        // expect2(service.getLastResult()).toEqual(['']);
        expect2(() => web.result).toEqual(null);
    });

    //* protocol param
    it('should pass handle protocol with web (hello)', async () => {
        const { lambda, service, web } = instance();
        const event: any = loadJsonSync('data/samples/events/protocol.event.sns.json');
        expect2(() => event.Records[0].Sns, 'MessageId').toEqual({ MessageId: '7820a87c-f73c-5c88-b2be-fe250be6b564' });

        //* CHANGE PARAM
        const body = JSON.parse(event.Records[0].Sns.Message);
        body.type = 'hello'; // override to `hello` type.
        event.Records[0].Sns.Message = JSON.stringify(body);

        //* PRE-CONDITION
        expect2(() => web.result).toEqual(null);
        expect2(service.getLastResult()).toEqual(null);

        //* RUN
        const res = await lambda.handle(event, null);
        expect2(res).toEqual(undefined);

        //* POST-CONDITION.
        const expected = { id: 'hello', cmd: 'test-protocol', hello: 'test-protocol hello' };
        expect2(service.getLastResult()).toEqual([$U.json(expected)]);
        expect2(() => web.result).toEqual({ ...expected });
    });

    //* Test non-protocol SNS message with listeners
    it('should handle non-protocol SNS message with listeners', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.sns.json');

        //* Add listener for non-protocol messages
        let receivedData: any;
        service.addListener(async (id, param, body, context) => {
            receivedData = { id, param, body, context };
            return 'listener-result';
        });

        //* Run
        const res = await lambda.handle(event, null);
        expect2(res).toEqual(undefined);

        //* Verify listener was called with correct data
        expect2(() => receivedData.id).toEqual('SNS');
        expect2(() => receivedData.param.subject).toEqual('test');
        expect2(() => receivedData.body.hello).toEqual('lemon');
        expect2(() => receivedData.context).toEqual(null);
    });

    //* Test protocol callback to same service
    it('should handle protocol callback to same service', async () => {
        const { lambda, service, web } = instance();
        const event: any = loadJsonSync('data/samples/events/protocol.event.sns.json');

        //* Modify event to have callback to same service
        const body = JSON.parse(event.Records[0].Sns.Message);
        body.type = 'hello';
        body.cmd = 'test-callback';
        body.id = 'result-id';
        body.callback = 'api://lemon-hello-api/hello/result-id/test-callback';
        event.Records[0].Sns.Message = JSON.stringify(body);

        //* Mock config to return same service name
        const mockConfig = {
            getService: () => 'lemon-hello-api',
        };
        lambda.config = mockConfig as any;

        //* Run
        const res = await lambda.handle(event, null);
        expect2(res).toEqual(undefined);

        //* Verify result
        const result = service.getLastResult();
        const expected = { id: 'result-id', cmd: 'test-callback', hello: 'test-callback result-id' };
        expect2(() => result.length).toEqual(1);
        expect2(() => JSON.parse(result[0])).toEqual(expected);
    });

    //* Test listener error handling in non-protocol SNS
    it('should handle listener error in non-protocol SNS', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.sns.json');

        //* Add listener that throws error
        service.addListener(async () => {
            throw new Error('Test listener error');
        });

        //* Run
        const res = await lambda.handle(event, null);
        expect2(res).toEqual(undefined);

        //* Verify error was handled
        const result = service.getLastResult();
        expect2(() => result[0]).toEqual('Test listener error');
    });

    //* Test non-JSON message body
    it('should handle non-JSON SNS message', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.sns.json');

        //* Modify message to be non-JSON
        event.Records[0].Sns.Message = 'plain text message';

        let receivedBody: any;
        service.addListener(async (id, param, body) => {
            receivedBody = body;
            return 'ok';
        });

        //* Run
        const res = await lambda.handle(event, null);
        expect2(res).toEqual(undefined);

        //* Verify body has data property
        expect2(() => receivedBody.data).toEqual('plain text message');
    });

    //* Test message attributes with Number type
    it('should handle SNS message attributes with Number type', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.sns.json');

        //* Add message attributes with Number type
        event.Records[0].Sns.MessageAttributes = {
            count: { Type: 'Number', Value: '42' },
            name: { Type: 'String', Value: 'test' },
        };

        let receivedParam: any;
        service.addListener(async (id, param) => {
            receivedParam = param;
            return 'ok';
        });

        //* Run
        const res = await lambda.handle(event, null);
        expect2(res).toEqual(undefined);

        //* Verify param has correct types
        expect2(() => receivedParam.count).toEqual(42);
        expect2(() => receivedParam.name).toEqual('test');
    });
});
