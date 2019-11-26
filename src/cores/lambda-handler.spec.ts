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
import { expect2, GETERR } from '../common/test-helper';

import { LambdaHandler, WEBHandler } from './lambda-handler';
import { NextHandler } from './core-types';
import { Handler } from 'aws-lambda';
class LambdaHandlerLocal extends LambdaHandler {
    public constructor() {
        super();
    }
}
export const instance = () => {
    const service = new LambdaHandlerLocal();
    return { service };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('LambdaHandler', () => {
    //! test callback
    it('should pass success w/ callback', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();
        service.setHandler('web', (event, context, callback) => {
            return callback(null, { statusCode: 200, body: 'ok' });
        })
        const event: any = { requestContext:{}, pathParameters: null };
        const context: any = {};
        const response: any = {};

        //! call handler.
        const res = await service.handle(event, context, (error: any, data: any)=>{
            response.error = error;
            response.result = data;
        }).catch(GETERR);
        expect2(res).toEqual(true);
        expect2(response.error).toEqual(null);
        expect2(response.result, 'statusCode').toEqual({ statusCode: 200 });
        expect2(response.result, 'body').toEqual({ body: 'ok' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test async
    it('should pass success w/ promised', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();
        service.setHandler('web', async (): Promise<any> => {
            return ({ statusCode: 200, body: 'ok' });
        })
        const event: any = { requestContext:{}, pathParameters: null };
        const context: any = {};
        const response: any = {};

        //! call handler.
        const res = await service.handle(event, context, (error: any, data: any)=>{
            response.error = error;
            response.result = data;
        }).catch(GETERR);
        expect2(res).toEqual(true);
        expect2(response.error).toEqual(null);
        expect2(response.result, 'statusCode').toEqual({ statusCode: 200 });
        expect2(response.result, 'body').toEqual({ body: 'ok' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test async error
    it('should pass success w/ callback + error', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();
        service.setHandler('web', () => {
            throw new Error('404 NOT FOUND');
        })
        const event: any = { requestContext:{}, pathParameters: null };
        const context: any = {};
        const response: any = {};

        //! call handler.
        const res = await service.handle(event, context, (error: any, data: any)=>{
            response.error = error;
            response.result = data;
        }).catch(GETERR);
        expect2(res).toEqual(false);
        expect2(response.error).toEqual(new Error('404 NOT FOUND'));
        expect2(response.result).toEqual(null);
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test async error
    it('should pass success w/ promised + error', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();
        service.setHandler('web', async (): Promise<any> => {
            throw new Error('404 NOT FOUND');
        })
        const event: any = { requestContext:{}, pathParameters: null };
        const context: any = {};
        const response: any = {};

        //! call handler.
        const res = await service.handle(event, context, (error: any, data: any)=>{
            response.error = error;
            response.result = data;
        }).catch(GETERR);
        expect2(res).toEqual(false);
        expect2(response.error).toEqual(new Error('404 NOT FOUND'));
        expect2(response.result).toEqual(null);
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test class.method
    it('should pass success w/ class.method type', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();

        interface InnerA {
            hello: Handler;
        };
        const $a = new class implements InnerA {
            private name: string = 'inner-a';
            public hello: Handler = async (event, context) => {
                const id = event.pathParameters && event.pathParameters.id;
                return ({ statusCode: 200, body: `hi - ${id}/${this.name}` });
            };
        }
        service.setHandler('web', $a.hello); // set class's method.
        const event: any = { requestContext:{}, pathParameters: { id:'!' } };
        const context: any = {};
        const response: any = {};

        //! call handler.
        const res = await service.handle(event, context, (error: any, data: any)=>{
            response.error = error;
            response.result = data;
        }).catch(GETERR);
        expect2(res).toEqual(true);
        expect2(response.error).toEqual(null);
        expect2(response.result).toEqual({  statusCode: 200, body: "hi - !/inner-a"});
        /* eslint-enable prettier/prettier */
        done();
    });
});
