/**
 * `lambda-cognito-handler.spec.ts`
 *
 * @author      Claire <claire@lemoncloud.io>
 * @date        2025-11-26 initial version
 *
 * @copyright (C) 2025 LemonCloud Co Ltd. - All Rights Reserved.
 */
import { expect2 } from '../../common/test-helper';
import { loadJsonSync } from '../../tools/';
import { LambdaHandler } from './lambda-handler';
import { LambdaCognitoHandler } from './lambda-cognito-handler';
import * as $lambda from './lambda-handler.spec';

class LambdaCognitoHandlerLocal extends LambdaCognitoHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
}

export const instance = () => {
    const { service: lambda } = $lambda.instance();
    const service = new LambdaCognitoHandlerLocal(lambda);
    return { lambda, service };
};

//! main test body.
describe('LambdaCognitoHandler', () => {
    //* Test PostAuthentication_Authentication event
    it('should handle PostAuthentication_Authentication event', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.cognito.json');

        expect2(() => event.triggerSource).toEqual('PostAuthentication_Authentication');
        expect2(() => event.userName).toEqual('c0c5eb23-b2dc-4c5a-82bb-a0b10d21d481');
        expect2(() => event.request.userAttributes.email).toEqual('steve@lemoncloud.io');

        const res = await lambda.handle(event, null);
        expect2(() => res).toEqual(undefined);
    });

    //* Test PreAuthentication_Authentication event
    it('should handle PreAuthentication_Authentication event', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.cognito.pre-auth.json');

        expect2(() => event.triggerSource).toEqual('PreAuthentication_Authentication');

        const res = await lambda.handle(event, null);
        expect2(() => res).toEqual(undefined);
    });

    //* Test cognito2 event
    it('should handle cognito2 event', async () => {
        const { lambda, service } = instance();
        const event: any = loadJsonSync('data/samples/events/sample.event.cognito2.json');

        const res = await lambda.handle(event, null);
        expect2(() => res).toEqual(undefined);
    });

    //* Test addListener method
    it('should have addListener method', async () => {
        const { service } = instance();

        const result = service.addListener();
        expect2(() => result).toEqual(undefined);
    });
});
