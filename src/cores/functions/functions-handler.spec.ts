/**
 * `lambda-handler.spec.ts`
 * - unit test for `lambda-handler`
 *
 *
 * @author      Ian Kim <ian@lemoncloud.io>
 * @date        2023-11-08 initial version
 *
 * @copyright (C) lemoncloud.io 2023 - All Rights Reserved.
 */
import { expect2, GETERR$ } from '../../common/test-helper';
import { FunctionHandler } from './functions-handler';

class FunctionHandlerLocal extends FunctionHandler {
    public constructor() {
        super();
    }
}
export const instance = () => {
    const service = new FunctionHandlerLocal();
    return { service };
};

////////////////////////////////////////////////////////////////////////////////////////////////////////
//! main test body.
describe('FunctionHandler', () => {
    //! test callback
    it('should pass success w/ callback', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();
        service.setHandler('web', (context: any, request: any, callback: any) => {
            return callback(null, { statusCode: 200, body: 'ok' });
        })
        const context: any = {
            invocationId: "e18a67ba-41e9-45c3-a29f-f2abc3570d15",
            bindingDefinitions: [
                {
                    "name": "req",
                    "type": "httpTrigger",
                    "direction": "in"
                },
                {
                    "name": "res",
                    "type": "http",
                    "direction": "out"
                }
            ],
            req: {
                "method": "GET",
                "url": "https://localhost:7071/api/hello",
                "headers": {
                }
            }
        }
        const request: any = {
            "method": "GET",
            "url": "https://localhost:7071/api/hello",
            "headers": {
            }
        };

        //! call handler.
        const response = await service.handle(context, request).catch(GETERR$);

        expect2(response, 'statusCode').toEqual({ statusCode: 200 });
        expect2(response, 'body').toEqual({ body: 'ok' });
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
        const context: any = {
            invocationId: "e18a67ba-41e9-45c3-a29f-f2abc3570d15",
            bindingDefinitions: [
                {
                    "name": "req",
                    "type": "httpTrigger",
                    "direction": "in"
                },
                {
                    "name": "res",
                    "type": "http",
                    "direction": "out"
                }
            ],
        };
        const request: any = {
            "method": "GET",
            "url": "https://localhost:7071/api/hello",
            "headers": {
            }
        };

        //! call handler.
        const response = await service.handle(context, request).catch(GETERR$);
        expect2(response).toEqual({ error: '404 NOT FOUND' });
        /* eslint-enable prettier/prettier */
        done();
    });

    //! test class.method
    it('should pass success w/ class.method type', async done => {
        /* eslint-disable prettier/prettier */
        const { service } = instance();

        interface InnerA {
            hello: any;
        }
        const $a = new class implements InnerA {
            public hello: any = async (context: any, request: any) => {
                const id = context.invocationId && context.bindingDefinitions && context.params.id;
                const cmd = context.invocationId && context.bindingDefinitions && context.params.cmd;
                const query = context.invocationId && context.bindingDefinitions && context.query.queryKey;
                return ({ statusCode: 200, body: `body: ${id}/${cmd}/${query}` });
            };
        }
        service.setHandler('web', $a.hello); // set class's method.
        const context: any = {
            invocationId: "e18a67ba-41e9-45c3-a29f-f2abc3570d15",
            bindingDefinitions: [
                {
                    "name": "req",
                    "type": "httpTrigger",
                    "direction": "in"
                },
                {
                    "name": "res",
                    "type": "http",
                    "direction": "out"
                }
            ],
            query: {
                "queryKey": "queryValue"
            },
            params: {
                "id": "1",
                "cmd": "hello"
            },

        };
        const request: any = {
            "method": "GET",
            "url": "https://localhost:7071/api/hello",
            "headers": {
            }
        };
        //! call handler.
        const response = await service.handle(context, request).catch(GETERR$);
        expect2(response).toEqual({ statusCode: 200, body: "body: 1/hello/queryValue" });
        /* eslint-enable prettier/prettier */
        done();
    });
});
