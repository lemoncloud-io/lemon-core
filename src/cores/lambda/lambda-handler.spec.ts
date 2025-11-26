/**
 * `lambda-handler.spec.ts`
 * - unit test for `lambda-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-11-20 initial version via backbone
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2, GETERR$ } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler, LambdaSubHandler } from './lambda-handler';
import { Handler } from 'aws-lambda';

/**
 * `LambdaHandlerLocal`
 * - local test class for `LambdaHandler`
 */
class LambdaHandlerLocal extends LambdaHandler {
    public constructor() {
        super();
    }
}

/**
 * factory function for `LambdaHandler`
 */
export const instance = () => {
    const service: LambdaHandler = new LambdaHandlerLocal();
    return { service };
};

//! main test body.
describe('LambdaHandler', () => {
    //* test findService
    it('should pass findService()', async () => {
        const { service } = instance();

        //* call handler.
        const _find = (name: string) => {
            const event = loadJsonSync(`data/samples/events/sample.event.${name ?? '-'}.json`);
            return service.findService(event);
        };
        expect2(() => _find('nothing')).toEqual();
        expect2(() => _find(undefined)).toEqual();
        expect2(() => _find(null)).toEqual();
        expect2(() => _find('')).toEqual();

        expect2(() => _find('web')).toEqual('web');
        expect2(() => _find('web.signed')).toEqual('web');
        expect2(() => _find('sns')).toEqual('sns');
        expect2(() => _find('sqs')).toEqual('sqs');

        expect2(() => _find('wss-conn')).toEqual('wss');
        expect2(() => _find('wss-echo')).toEqual('wss');

        expect2(() => _find('alb')).toEqual('alb');
        expect2(() => _find('cron')).toEqual('cron');
        expect2(() => _find('cognito')).toEqual('cognito');
        expect2(() => _find('dynamo-stream')).toEqual('dds');
    });

    //* test callback
    it('should pass success w/ callback', async () => {
        const { service } = instance();
        service.setHandler('web', (event, context, callback) => {
            return callback(null, { statusCode: 200, body: 'ok' });
        });
        const event: any = { requestContext: {}, pathParameters: null };
        const context: any = {};

        //* call handler.
        const response = await service.handle(event, context).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        expect2(response, 'body').toEqual({ body: 'ok' });
    });

    //* test async
    it('should pass success w/ promised', async () => {
        const { service } = instance();
        service.setHandler('web', async (): Promise<any> => {
            return { statusCode: 200, body: 'ok' };
        });
        const event: any = { requestContext: {}, pathParameters: null };
        const context: any = {};

        //* call handler.
        const response = await service.handle(event, context).catch(GETERR$);
        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        expect2(response, 'body').toEqual({ body: 'ok' });
    });

    //* test async error
    it('should pass success w/ callback + error', async () => {
        const { service } = instance();
        service.setHandler('web', () => {
            throw new Error('404 NOT FOUND');
        });
        const event: any = { requestContext: {}, pathParameters: null };
        const context: any = {};

        //* call handler.
        const response = await service.handle(event, context).catch(GETERR$);
        expect2(response).toEqual({ error: '404 NOT FOUND' });
    });

    //* test async error
    it('should pass success w/ promised + error', async () => {
        const { service } = instance();
        service.setHandler('web', async (): Promise<any> => {
            throw new Error('404 NOT FOUND');
        });
        const event: any = { requestContext: {}, pathParameters: null };
        const context: any = {};

        //* call handler.
        const response = await service.handle(event, context).catch(GETERR$);
        expect2(response).toEqual({ error: '404 NOT FOUND' });
    });

    //* test class.method
    it('should pass success w/ class.method type', async () => {
        const { service } = instance();

        interface InnerA {
            hello: Handler;
        }
        const $a = new (class implements InnerA {
            private name: string = 'inner-a';
            public hello: Handler = async (event, context) => {
                const id = event.pathParameters && event.pathParameters.id;
                return { statusCode: 200, body: `hi - ${id}/${this.name}` };
            };
        })();
        service.setHandler('web', $a.hello); // set class's method.
        const event: any = { requestContext: {}, pathParameters: { id: '!' } };
        const context: any = {};

        //* call handler.
        const response = await service.handle(event, context).catch(GETERR$);
        expect2(response).toEqual({ statusCode: 200, body: 'hi - !/inner-a' });
    });

    //* Test getHandler method
    it('should test getHandler method', async () => {
        const { service } = instance();

        //* Set handler as object (LambdaHandlerService)
        const mockService = { handle: async () => ({ statusCode: 200 }) };
        service.setHandler('web', mockService as any);
        const handler = service.getHandler('web');
        expect2(() => handler).toEqual(mockService);

        //* Test with non-existent handler
        const nullHandler = service.getHandler('unknown' as any);
        expect2(() => nullHandler).toEqual(null);
    });

    //* Test notification event detection
    it('should detect notification event', async () => {
        const { service } = instance();
        const event = {
            requestContext: {},
            headers: {
                'x-amz-sns-message-type': 'Notification',
                'x-amz-sns-message-id': 'test-id',
                'x-amz-sns-topic-arn': 'arn:aws:sns:test',
            },
        };
        expect2(() => service.findService(event)).toEqual('notification');
    });

    //* Test handler with packContext
    it('should handle service with custom packContext', async () => {
        const { service } = instance();

        //* Test with packContext returning Promise
        const mockService1 = {
            handle: async (event: any, context: any) => ({ statusCode: 200, context }),
            packContext: async () => ({ custom: 'context' }),
        };
        service.setHandler('web', mockService1 as any);
        const event1: any = { requestContext: {}, pathParameters: null };
        const response1 = await service.handle(event1, null as any);
        expect2(() => response1.context).toEqual({ custom: 'context' });

        //* Test with packContext returning non-Promise
        const mockService2 = {
            handle: async (event: any, context: any) => ({ statusCode: 200, context }),
            packContext: () => ({ sync: 'context' } as any),
        };
        service.setHandler('web', mockService2 as any);
        const response2 = await service.handle(event1, null as any);
        expect2(() => response2.context).toEqual({ sync: 'context' });

        //* Test without packContext
        const mockService3 = {
            handle: async (event: any, context: any) => ({ statusCode: 200, hasContext: !!context }),
        };
        service.setHandler('web', mockService3 as any);
        const response3 = await service.handle(event1, null as any);
        expect2(() => response3.hasContext).toEqual(true);
    });

    //* Test unknown event error
    it('should handle unknown event error', async () => {
        const { service } = instance();
        const event: any = { unknown: 'event' };
        const error = await service.handle(event, null as any).catch(GETERR$);
        expect2(() => error.error).toEqual('400 UNKNOWN EVENT - service:');
    });

    //* Test handleProtocol method
    it('should test handleProtocol method', async () => {
        const { service } = instance();

        //* Test with web handler that supports protocol
        const mockWebService = {
            handle: async () => ({ statusCode: 200 }),
            handleProtocol: async (param: any) => ({ result: param.cmd }),
        };
        service.setHandler('web', mockWebService as any);
        const result = await service.handleProtocol({ cmd: 'test' } as any);
        expect2(() => result).toEqual({ result: 'test' });

        //* Test without web handler (error case)
        const service2 = new LambdaHandlerLocal();
        const error = await service2.handleProtocol({ cmd: 'test' } as any).catch(GETERR$);
        expect2(() => error.error).toEqual('500 NO WEB HANDLER - name:web');
    });

    //* Test packContext method
    it('should test packContext method', async () => {
        const { service } = instance();
        const event = { test: 'event' };
        const context: any = { functionName: 'test-function' };
        const result = await service.packContext(event, context);
        expect2(() => result).toEqual({});
    });

    //* Test LambdaSubHandler constructor error
    it('should throw error when lambda is null in LambdaSubHandler', () => {
        class TestSubHandler extends LambdaSubHandler<any> {
            handle = async () => {};
        }
        const error = (() => {
            try {
                new TestSubHandler(null as any, 'web');
                return null;
            } catch (e) {
                return e.message;
            }
        })();
        expect2(() => error).toEqual('@lambda (lambda-handler) is required!');
    });

    //* Test buildReportError function
    it('should test buildReportError function', async () => {
        const { buildReportError } = await import('./lambda-handler');
        const testError = new Error('test error');

        //* Test with isReport=false
        const reportFn1 = buildReportError(false);
        const result1 = await reportFn1(testError, null, null, { test: 'data' });
        expect2(() => result1).toEqual('test error');

        //* Test with isReport=true (will try to report but catch error)
        const reportFn2 = buildReportError(true);
        const result2 = await reportFn2(testError, null, null, null);
        expect2(() => result2).toEqual('test error');
    });

    //* Test error handling with REPORT_ERROR
    it('should test error handling with REPORT_ERROR enabled', async () => {
        const { service } = instance();
        const { LambdaHandler } = await import('./lambda-handler');

        //* Save original value
        const originalReportError = LambdaHandler.REPORT_ERROR;

        //* Enable REPORT_ERROR
        LambdaHandler.REPORT_ERROR = true;

        service.setHandler('web', () => {
            throw new Error('test error');
        });
        const event: any = { requestContext: {}, pathParameters: null };
        const error = await service.handle(event, null as any).catch(GETERR$);
        expect2(() => error.error).toEqual('test error');

        //* Restore original value
        LambdaHandler.REPORT_ERROR = originalReportError;
    });

    //* Test LambdaSubHandler constructor success
    it('should test LambdaSubHandler constructor success', () => {
        const { service } = instance();

        class TestSubHandler extends LambdaSubHandler<any> {
            handle = async () => ({ result: 'ok' });
            public getType() {
                return this.type;
            }
        }

        //* Create with valid lambda and type
        const handler = new TestSubHandler(service, 'web');
        expect2(() => handler.getType()).toEqual('web');
        expect2(() => service.getHandler('web')).toEqual(handler);
    });

    //* Test handler with null packContext
    it('should handle service with null packContext', async () => {
        const { service } = instance();

        //* Test with packContext returning null
        const mockService = {
            handle: async (event: any, context: any) => ({ statusCode: 200, hasContext: context === null }),
            packContext: (): any => null,
        };
        service.setHandler('web', mockService as any);
        const event: any = { requestContext: {}, pathParameters: null };
        const response = await service.handle(event, null as any);
        expect2(() => response.hasContext).toEqual(true);
    });

    //* Test error handling with REPORT_ERROR disabled
    it('should test error handling with REPORT_ERROR disabled', async () => {
        const { service } = instance();
        const { LambdaHandler } = await import('./lambda-handler');

        //* Save original value
        const originalReportError = LambdaHandler.REPORT_ERROR;

        //* Disable REPORT_ERROR
        LambdaHandler.REPORT_ERROR = false;

        service.setHandler('web', () => {
            throw new Error('test error no report');
        });
        const event: any = { requestContext: {}, pathParameters: null };
        const error = await service.handle(event, null as any).catch(GETERR$);
        expect2(() => error.error).toEqual('test error no report');

        //* Restore original value
        LambdaHandler.REPORT_ERROR = originalReportError;
    });
});
