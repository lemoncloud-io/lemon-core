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
import { describe, expect, it, vi } from 'vitest';
import { expect2, GETERR$ } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from './lambda-handler';
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
});
