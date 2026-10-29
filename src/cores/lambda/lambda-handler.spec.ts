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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi } from 'vitest';
import { expect2, GETERR$ } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from './lambda-handler';
import { $engine } from '../../engine/';
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

    //* v5 B10-3: the header log is masked, the service type is not changed.
    it('should mask secret headers in the log of findService() (v5)', async () => {
        const { service } = instance();
        const TOKEN = 'Bearer fake-token-b10-3-0123456789';
        const CONTEXT = '{"requestId":"fake-req-b10-3"}';
        const event = loadJsonSync('data/samples/events/sample.event.web.json');
        event.headers = {
            ...event.headers,
            Authorization: TOKEN,
            'x-protocol-context': CONTEXT,
            Cookie: 'sid=fake-b10-3',
        };
        const spy = vi.spyOn($engine.$console, 'log');
        try {
            //* same type as before (the checks read the original headers).
            expect2(() => service.findService(event)).toEqual('web');
            const text = spy.mock.calls.map(args => args.join(' ')).join('\n');
            expect(text).toContain('> headers =');
            expect(text).toContain(`"Authorization":"[masked:${TOKEN.length}]"`);
            expect(text).toContain(`"x-protocol-context":"[masked:${CONTEXT.length}]"`);
            for (const secret of [TOKEN, 'fake-token-b10-3', CONTEXT, 'fake-req-b10-3', 'sid=fake-b10-3'])
                expect(text).not.toContain(secret);
            //* the event itself is not changed.
            expect2(() => event.headers.Authorization).toEqual(TOKEN);
        } finally {
            spy.mockRestore();
        }
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

        //* call handler. v5 B5: never rejects — a web failure is the HTTP response (was a reject).
        const response = await service.handle(event, context).catch(GETERR$);
        expect2(response, 'statusCode,body').toEqual({ statusCode: 404, body: '404 NOT FOUND' });
    });

    //* test async error
    it('should pass success w/ promised + error', async () => {
        const { service } = instance();
        service.setHandler('web', async (): Promise<any> => {
            throw new Error('404 NOT FOUND');
        });
        const event: any = { requestContext: {}, pathParameters: null };
        const context: any = {};

        //* call handler. v5 B5: never rejects — a web failure is the HTTP response (was a reject).
        const response = await service.handle(event, context).catch(GETERR$);
        expect2(response, 'statusCode,body').toEqual({ statusCode: 404, body: '404 NOT FOUND' });
    });

    //* v5 B5: no rejection for any event (D7).
    it('should resolve failures of any event (v5)', async () => {
        const { service } = instance();
        //* unknown event → `{ error }`.
        expect2(await service.handle({ hello: 1 }, {} as any).catch(GETERR$)).toEqual({
            error: '400 UNKNOWN EVENT - service:',
        });
        //* no event → `{ error }`.
        expect2(await service.handle(null, {} as any).catch(GETERR$)).toEqual({ error: '@event is required!' });
        //* sqs handler throws → every record in `batchItemFailures`.
        service.setHandler('sqs', () => {
            throw new Error('boom-sqs');
        });
        const sqs = {
            Records: [
                { eventSource: 'aws:sqs', messageId: 'm1' },
                { eventSource: 'aws:sqs', messageId: 'm2' },
            ],
        };
        expect2(await service.handle(sqs, {} as any).catch(GETERR$)).toEqual({
            batchItemFailures: [{ itemIdentifier: 'm1' }, { itemIdentifier: 'm2' }],
        });
        //* dds handler rejects → every record by `SequenceNumber`.
        service.setHandler('dds', async () => {
            throw new Error('boom-dds');
        });
        const dds = { Records: [{ dynamodb: { SequenceNumber: 's1' } }] };
        expect2(await service.handle(dds, {} as any).catch(GETERR$)).toEqual({
            batchItemFailures: [{ itemIdentifier: 's1' }],
        });
        //* sns handler rejects → `{ error }`.
        service.setHandler('sns', async () => {
            throw new Error('boom-sns');
        });
        expect2(await service.handle({ Records: [{ Sns: {} }] }, {} as any).catch(GETERR$)).toEqual({
            error: 'boom-sns',
        });
        //* cognito handler throws → `handle()` rejects with the same message (the response contract).
        service.setHandler('cognito', () => {
            throw new Error('boom-cognito');
        });
        const cognito = loadJsonSync('data/samples/events/sample.event.cognito.json');
        expect2(() => service.findService(cognito)).toEqual('cognito');
        expect2(await service.handle(cognito, {} as any).catch(GETERR$)).toEqual({ error: 'boom-cognito' });
        await expect(service.handle(cognito, {} as any)).rejects.toThrow('boom-cognito');
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
