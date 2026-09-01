/**
 * `aws-lambda-helper.spec.ts`
 * - unit test for `aws-lambda-helper`
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GETERR } from '../../common/test-helper';

const lambdaMock = vi.hoisted(() => ({
    clients: [] as object[],
    send: vi.fn(),
}));

vi.mock('@aws-sdk/client-lambda', () => {
    class InvokeCommand {
        public readonly input: object;
        public constructor(input: object) {
            this.input = input;
        }
    }

    class LambdaClient {
        public readonly send = lambdaMock.send;
        public constructor(config: object) {
            lambdaMock.clients.push(config);
        }
    }

    return { InvokeCommand, LambdaClient };
});

import { invokeLambda } from './aws-lambda-helper';
import { APIGatewayProxyEvent } from 'aws-lambda';

type InvokeInput = {
    FunctionName: string;
    Payload?: Uint8Array;
    InvocationType?: string;
};

const encodeLambdaPayload = (payload: object): Uint8Array => new TextEncoder().encode(JSON.stringify(payload));
const decodeInputPayload = (input: InvokeInput): string => new TextDecoder().decode(input.Payload);
const lastInvokeInput = (): InvokeInput => lambdaMock.send.mock.calls.at(-1)?.[0]?.input as InvokeInput;

const asEvent = (base?: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent =>
    ({
        httpMethod: 'POST',
        path: '/hello/0',
        headers: { 'content-type': 'application/json' },
        multiValueHeaders: {},
        queryStringParameters: { q: 'test' },
        multiValueQueryStringParameters: null,
        pathParameters: { type: 'hello', id: '0', cmd: '' },
        requestContext: {
            accountId: '1234',
            httpMethod: 'POST',
            identity: null as any,
            path: '/hello/0',
            requestId: 'req-1',
            stage: 'dev',
        },
        body: JSON.stringify({ name: 'lemon' }),
        isBase64Encoded: false,
        ...base,
    } as APIGatewayProxyEvent);

describe('invokeLambda', () => {
    beforeEach(() => {
        lambdaMock.clients.splice(0);
        lambdaMock.send.mockReset();
    });

    it('should prepare InvokeCommand input from API Gateway event payload', async () => {
        const body = { ok: true, count: 2 };
        const event = asEvent();
        lambdaMock.send.mockResolvedValueOnce({
            StatusCode: 200,
            Payload: encodeLambdaPayload({ statusCode: 200, body: JSON.stringify(body) }),
        });

        const res = await invokeLambda('target-lambda', event, {
            param: { service: 'target-service', type: 'hello', context: {} },
            config: { region: 'ap-northeast-2' },
        });

        expect(res).toEqual(body);
        expect(lambdaMock.clients).toEqual([{ region: 'ap-northeast-2' }]);
        expect(lastInvokeInput().FunctionName).toBe('target-lambda');
        expect(lastInvokeInput().InvocationType).toBeUndefined();
        expect(JSON.parse(decodeInputPayload(lastInvokeInput()))).toEqual(event);
    });

    it('should send raw string payload without JSON wrapping', async () => {
        lambdaMock.send.mockResolvedValueOnce({
            StatusCode: 200,
            Payload: encodeLambdaPayload({ statusCode: 200, body: JSON.stringify({ accepted: true }) }),
        });

        const res = await invokeLambda('target-lambda', '{"raw":true}');

        expect(res).toEqual({ accepted: true });
        expect(decodeInputPayload(lastInvokeInput())).toBe('{"raw":true}');
    });

    it('should enable asynchronous Event invocation when useEvent is true', async () => {
        lambdaMock.send.mockResolvedValueOnce({ StatusCode: 202 });

        const res = await invokeLambda('target-lambda', asEvent(), { useEvent: true });

        expect(res).toEqual({ StatusCode: 202, Payload: undefined });
        expect(lastInvokeInput().InvocationType).toBe('Event');
    });

    it('should read payload.text before payload.body', async () => {
        lambdaMock.send.mockResolvedValueOnce({
            StatusCode: 200,
            Payload: encodeLambdaPayload({
                statusCode: 200,
                text: 'plain text result',
                body: JSON.stringify({ ok: false }),
            }),
        });

        const res = await invokeLambda('target-lambda', asEvent());

        expect(res).toBe('plain text result');
    });

    it('should keep non JSON body string when body parsing fails', async () => {
        lambdaMock.send.mockResolvedValueOnce({
            StatusCode: 200,
            Payload: encodeLambdaPayload({ statusCode: 200, body: 'not-json-body' }),
        });

        const res = await invokeLambda('target-lambda', asEvent());

        expect(res).toBe('not-json-body');
    });

    it('should reject 400 and 404 status with parsed body message', async () => {
        lambdaMock.send.mockResolvedValueOnce({
            StatusCode: 200,
            Payload: encodeLambdaPayload({ statusCode: 404, body: JSON.stringify('404 NOT FOUND - test') }),
        });

        const err = await invokeLambda('target-lambda', asEvent()).catch(GETERR);

        expect(err).toBe('404 NOT FOUND - test');
    });

    it('should reject non success status with Lambda Error message', async () => {
        lambdaMock.send.mockResolvedValueOnce({
            StatusCode: 200,
            Payload: encodeLambdaPayload({ statusCode: 500, body: JSON.stringify({ error: 'broken' }) }),
        });

        const err = await invokeLambda('target-lambda', asEvent()).catch(GETERR);

        expect(err).toBe('{"error":"broken"}');
    });

    it('should rethrow LambdaClient send errors', async () => {
        lambdaMock.send.mockRejectedValueOnce(new Error('network is unavailable'));

        const err = await invokeLambda('target-lambda', asEvent(), {
            param: { service: 'target-service', type: 'hello', context: {} },
        }).catch(GETERR);

        expect(err).toBe('network is unavailable');
    });

    it('should reject when target is empty before creating LambdaClient', async () => {
        const err = await invokeLambda('', asEvent()).catch(GETERR);

        expect(err).toBe('@target(function) is required - invokeLambda()');
        expect(lambdaMock.clients).toEqual([]);
        expect(lambdaMock.send).not.toHaveBeenCalled();
    });
});
