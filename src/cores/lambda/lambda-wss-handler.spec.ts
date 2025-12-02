/**
 * `lambda-wss-handler.spec.ts`
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2025-11-26 initial version
 *
 * @copyright (C) 2025 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2 } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from './lambda-handler';
import { LambdaWSSHandler, buildResponse, success, notfound, failure } from './lambda-wss-handler';
import * as $lambda from './lambda-handler.spec';

class LambdaWSSHandlerLocal extends LambdaWSSHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
}

export const instance = () => {
    const { service: lambda } = $lambda.instance();
    const service = new LambdaWSSHandlerLocal(lambda);
    return { lambda, service };
};

//! main test body.
describe('LambdaWSSHandler', () => {
    //* Test buildResponse with JSON body
    it('should build response with JSON body', async () => {
        const res = buildResponse(200, { hello: 'world' });
        expect2(() => res.statusCode).toEqual(200);
        expect2(() => res.headers['Content-Type']).toEqual('application/json; charset=utf-8');
        expect2(() => res.headers['Access-Control-Allow-Origin']).toEqual('*');
        expect2(() => res.headers['Access-Control-Allow-Credentials']).toEqual(true);
        expect2(() => res.body).toEqual('{"hello":"world"}');
    });

    //* Test buildResponse with plain text body
    it('should build response with plain text body', async () => {
        const res = buildResponse(200, 'plain text');
        expect2(() => res.statusCode).toEqual(200);
        expect2(() => res.headers['Content-Type']).toEqual('text/plain; charset=utf-8');
        expect2(() => res.body).toEqual('plain text');
    });

    //* Test buildResponse with HTML body
    it('should build response with HTML body', async () => {
        const res = buildResponse(200, '<html><body>Hello</body></html>');
        expect2(() => res.statusCode).toEqual(200);
        expect2(() => res.headers['Content-Type']).toEqual('text/html; charset=utf-8');
        expect2(() => res.body).toEqual('<html><body>Hello</body></html>');
    });

    //* Test success helper
    it('should build success response', async () => {
        const res = success({ message: 'ok' });
        expect2(() => res.statusCode).toEqual(200);
        expect2(() => res.body).toEqual('{"message":"ok"}');
    });

    //* Test notfound helper
    it('should build notfound response', async () => {
        const res = notfound('Resource not found');
        expect2(() => res.statusCode).toEqual(404);
        expect2(() => res.body).toEqual('Resource not found');
    });

    //* Test failure helper
    it('should build failure response', async () => {
        const res = failure({ error: 'Service unavailable' });
        expect2(() => res.statusCode).toEqual(503);
        expect2(() => res.body).toEqual('{"error":"Service unavailable"}');
    });

    //* Test WSS connection event
    it('should handle WSS connection event', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.wss-conn.json');

        expect2(() => event.requestContext.routeKey).toEqual('$connect');
        expect2(() => event.requestContext.eventType).toEqual('CONNECT');

        const res = await lambda.handle(event, null);
        expect2(() => res.statusCode).toEqual(200);
        expect2(() => res.body).toEqual('ok');
    });

    //* Test WSS disconnection event
    it('should handle WSS disconnection event', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.wss-discon.json');

        expect2(() => event.requestContext.eventType).toEqual('DISCONNECT');

        const res = await lambda.handle(event, null);
        expect2(() => res.statusCode).toEqual(200);
        expect2(() => res.body).toEqual('ok');
    });

    //* Test WSS echo message event
    it('should handle WSS echo message event', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.wss-echo.json');

        expect2(() => event.requestContext.routeKey).toEqual('$default');
        expect2(() => event.requestContext.eventType).toEqual('MESSAGE');
        expect2(() => event.body).toEqual('{"echo":"hello"}');

        const res = await lambda.handle(event, null);
        expect2(() => res.statusCode).toEqual(200);
        expect2(() => res.body).toEqual('ok');
    });

    //* Test WSS regular message event
    it('should handle WSS regular message event', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.wss-msg.json');

        expect2(() => event.requestContext.eventType).toEqual('MESSAGE');

        const res = await lambda.handle(event, null);
        expect2(() => res.statusCode).toEqual(200);
        expect2(() => res.body).toEqual('ok');
    });

    //* Test addListener method
    it('should have addListener method', async () => {
        const { service } = instance();

        const result = service.addListener();
        expect2(() => result).toEqual(undefined);
    });
});
