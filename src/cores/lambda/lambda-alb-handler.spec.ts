/**
 * `lambda-alb-handler.spec.ts`
 * - unit test for `lambda-alb-handler`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2025-05-14 initial version via backbone
 *
 * @copyright (C) 2025 LemonCloud Co Ltd. - All Rights Reserved.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { describe, expect, it, vi } from 'vitest';
import { NextContext } from 'lemon-model';
import { expect2, GETERR$ } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaALBHandler } from './lambda-alb-handler';
import { ALBEvent, LambdaHandler } from './lambda-handler';
import * as $lambda from './lambda-handler.spec';

class LambdaALBHandlerLocal extends LambdaALBHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
}
export const instance = () => {
    const { service: lambda } = $lambda.instance();
    const service = new LambdaALBHandlerLocal(lambda);
    return { lambda, service };
};

//! main test body.
describe('LambdaAlbHandler', () => {
    //* list in web-handler
    it('should pass handler listener', async () => {
        const { service, lambda } = instance();
        const event = loadJsonSync<ALBEvent>('data/samples/events/sample.event.alb.json');
        expect2(() => service.hello()).toEqual('lambda-alb-handler');

        //* handle directly from alb
        if (1) {
            const $res = await service.handle(event, null).catch(GETERR$);
            expect2(() => $res).toEqual({
                statusCode: 403,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                },
                body: '403 NOT SUPPORTED - no handler for alb',
                isBase64Encoded: false,
            });
        }

        //* sample handler.
        service.setHandler(async (id, thiz, event, context) => {
            const hello = thiz.hello();
            const result = { id, hello, event, context };
            return thiz.buildResponse(200, result);
        });

        const expCtx: NextContext = {
            domain: '3.35.112.206',
            identity: { lang: undefined },
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.190 Safari/537.36',
        };
        expect2(await service.packContext(event)).toEqual({ ...expCtx });

        //* handle directly from alb
        if (1) {
            const $res = await service.handle(event, null);
            const $body = JSON.parse($res?.body);
            expect2(() => $res, '!body').toEqual({
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                },
                isBase64Encoded: false,
            });
            expect2(() => $body, 'id,hello').toEqual({
                id: 'arn:aws:elasticloadbalancing:ap-northeast-2:085403634746:targetgroup/lemon-hello-api/15a8fd88ea4f1fb5',
                hello: 'lambda-alb-handler',
            });
            expect2(() => $body?.context).toEqual(null);
        }

        //* handle from lambda
        if (1) {
            const $res = await lambda.handle(event, null);
            const $body = JSON.parse($res?.body);
            expect2(() => $res, '!body').toEqual({
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                },
                isBase64Encoded: false,
            });
            expect2(() => $body, 'id,hello').toEqual({
                id: 'arn:aws:elasticloadbalancing:ap-northeast-2:085403634746:targetgroup/lemon-hello-api/15a8fd88ea4f1fb5',
                hello: 'lambda-alb-handler',
            });
            expect2(() => $body?.context).toEqual({ ...expCtx });
        }
    });
});
