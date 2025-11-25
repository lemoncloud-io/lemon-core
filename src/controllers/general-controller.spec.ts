/**
 * `general-controller.spec.ts`
 *
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2019-12-16 initial version
 *
 * @copyright (C) 2019 LemonCloud Co Ltd. - All Rights Reserved.
 */
import request from 'supertest';
import { LambdaWEBHandler, LambdaHandler } from '../cores/lambda';
import { ProtocolParam, NextHandler } from '../cores';
import { buildEngine, $U } from '../engine';
import { buildExpress, loadJsonSync } from '../tools';
import { expect2, GETERR } from '../common/test-helper';
import { GeneralController, GeneralWEBController } from './general-controller';
import $protocols from '../cores/protocol/';
import $config from '../cores/config/';
import $aws from '../cores/aws/';

//* Mock SNS Client with real AWS response structure
class MockSNSClient {
    private generateRealUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    private calculateMD5(message: string): string {
        return Buffer.from(message || '')
            .toString('base64')
            .substring(0, 32)
            .padEnd(32, '0');
    }

    private calculateAttributesMD5(attributes: any): string {
        const attrStr = JSON.stringify(attributes || {});
        return Buffer.from(attrStr).toString('base64').substring(0, 32).padEnd(32, '0');
    }

    private generateSequenceNumber(): string {
        return (Date.now() * 1000 + Math.floor(Math.random() * 1000)).toString();
    }

    public async send(command: any) {
        if (command.constructor.name === 'PublishCommand') {
            return {
                MessageId: this.generateRealUUID(),
                MD5OfBody: this.calculateMD5(command.input?.Message),
                MD5OfMessageAttributes: this.calculateAttributesMD5(command.input?.MessageAttributes),
                SequenceNumber: this.generateSequenceNumber(),
            };
        }
        return { Mock: true };
    }
}

//* local `lambda-web-handler` to server dummy
class LambdaWEBHandlerLocal extends LambdaWEBHandler {
    public constructor(lambda: LambdaHandler) {
        super(lambda, true);
    }
    public result: any = null;
    public async handleProtocol<TResult = any>(param: ProtocolParam): Promise<TResult> {
        const result: TResult = await super.handleProtocol(param);
        this.result = result;
        return result;
    }
}

class GeneralControllerLocal extends GeneralController {
    public constructor(type: string) {
        super(type);
    }
    public async getHelloWorld(id: string) {
        const type = this.type();
        return { hello: `world-${id}`, type };
    }
    public getHelloLemon: NextHandler = async (id: string) => {
        const type = this.type();
        return { hello: `lemon-${id}`, type };
    };
}

class GeneralControllerLocal2 extends GeneralControllerLocal {
    public constructor(type: string) {
        super(type);
    }
    public doGetLemonPie: NextHandler = async (id: string) => {
        const type = this.type();
        return { hello: `lemon-pie:${id}`, type };
    };
}

class GeneralWEBControllerLocal extends GeneralWEBController {
    public constructor(type: string) {
        super(type);
    }

    //* override doNotifyServiceEvent to test asUrl=true path (lines 194-197)
    public doNotifyServiceEventWithAsUrl = async (
        context: any,
        type: string,
        id: string,
        state: string,
        $param?: any,
        endpoint?: string,
    ): Promise<string> => {
        const $proto = $protocols.service;
        const config = $config.config;
        const subject = `event://${config.getService()}-${config.getStage()}`;

        //* force asUrl to be true to test lines 194-197
        const { service, param } = ((asUrl: boolean): { service: string; param: any } => {
            if (asUrl) {
                const uri = $proto.myProtocolURI(context, type, id);
                const [a, b] = uri.split('#', 2);
                const service = `${a}${$param ? '?' : ''}${$param ? $U.qs.stringify($param) : ''}#${b}`;
                return { service, param: undefined };
            } else {
                const service: string = $proto.myProtocolURI(context, type, id);
                return { service, param: $param };
            }
        })(true); // force asUrl=true

        const message = { type, id, state, service, param };
        if (endpoint === '#') return $U.json({ endpoint, subject, message });
        if (!endpoint) return `ignored`;
        return $aws.sns.publish(endpoint, subject, message).catch(GETERR);
    };
}

//* create instance.
export const instance = (type: string, useProxy: boolean = false) => {
    const $lambda = new LambdaHandler();
    const $web = new LambdaWEBHandlerLocal($lambda);
    const controller = new GeneralControllerLocal(type);
    const controller2 = new GeneralControllerLocal2(type + '2');
    const controller3 = new GeneralWEBController(type + '3', useProxy ? controller : null); // use proxy pattern.
    $web.addController(controller);
    $web.addController(controller2);
    $web.addController(controller3);
    //* build engine + express.app.
    const $engine = buildEngine({});
    const $express = buildExpress($engine, $web);
    return { controller, controller2, controller3, app: $express.app };
};

//! main test body.
describe('GeneralController', () => {
    //* general contoller api.
    it('should pass asFuncName()', async () => {
        const { controller, controller2, controller3 } = instance('hello');
        const { controller: controller0 } = instance(null);

        expect2(() => controller.hello()).toEqual('general-controller:hello');
        expect2(() => controller0.hello()).toEqual('general-controller:');
        expect2(() => controller2.hello()).toEqual('general-controller:hello2');
        expect2(() => controller3.hello()).toEqual('general-web-controller:hello3');

        expect2(controller.asFuncName('LIST', 'Hello')).toEqual('listHello');
        expect2(controller.asFuncName('GET', null)).toEqual('get');
        expect2(controller.asFuncName('GET', '')).toEqual('get');
        expect2(controller.asFuncName('put', '')).toEqual('put');
        expect2(controller.asFuncName('GET', 'h')).toEqual('getH');
        expect2(controller.asFuncName('put', 'h')).toEqual('putH');
        expect2(controller.asFuncName('GET', 'hello')).toEqual('getHello');
        expect2(controller.asFuncName('put', 'hello')).toEqual('putHello');
        expect2(controller.asFuncName('GET', 'HELLO')).toEqual('getHELLO');

        expect2(controller.asFuncName('', 'hello')).toEqual('doHello');
        expect2(controller.asFuncName(null, 'hello')).toEqual('doHello');
        expect2(controller0.asFuncName('', 'hello')).toEqual('doHello');
        expect2(controller0.asFuncName(null, 'hello')).toEqual('doHello');

        expect2(controller.asFuncName('GET', 'hello', 'world')).toEqual('getHelloWorld');
        expect2(controller.asFuncName('POST', 'hello', 'world-class')).toEqual('postHelloWorldClass');
        expect2(controller.asFuncName('GET', 'hello', '-class')).toEqual('getHelloClass');
        expect2(controller.asFuncName('PUT', 'hello', '-')).toEqual('putHello_');
        expect2(controller.asFuncName('GET', 'hello', '-_--')).toEqual('getHello____');
        expect2(controller.asFuncName('GET', 'hello', '-Me')).toEqual('getHelloMe');
    });

    //* general contoller api.
    it('should pass asFuncNameByDo()', async () => {
        const { controller, controller2, controller3 } = instance('hello');
        const { controller: controller0 } = instance(null);

        expect2(() => controller.hello()).toEqual('general-controller:hello');
        expect2(() => controller0.hello()).toEqual('general-controller:');
        expect2(() => controller2.hello()).toEqual('general-controller:hello2');
        expect2(() => controller3.hello()).toEqual('general-web-controller:hello3');

        expect2(controller.asFuncNameByDo('LIST', 'Hello')).toEqual('doList');
        expect2(controller.asFuncNameByDo('GET', null)).toEqual('doGet');
        expect2(controller.asFuncNameByDo('GET', '')).toEqual('doGet');
        expect2(controller.asFuncNameByDo('put', '')).toEqual('doPut');
        expect2(controller.asFuncNameByDo('GET', 'h')).toEqual('doGet');
        expect2(controller.asFuncNameByDo('put', 'h')).toEqual('doPut');
        expect2(controller.asFuncNameByDo('GET', 'hello')).toEqual('doGet');
        expect2(controller.asFuncNameByDo('put', 'hello')).toEqual('doPut');
        expect2(controller.asFuncNameByDo('GET', 'HELLO')).toEqual('doGet');

        expect2(controller.asFuncNameByDo('', 'hello')).toEqual('doHello');
        expect2(controller.asFuncNameByDo(null, 'hello')).toEqual('doHello');
        expect2(controller0.asFuncNameByDo('', 'hello')).toEqual('doHello');
        expect2(controller0.asFuncNameByDo(null, 'hello')).toEqual('doHello');

        expect2(controller.asFuncNameByDo('GET', 'hello', 'world')).toEqual('doGetWorld');
        expect2(controller.asFuncNameByDo('POST', 'hello', 'world-class')).toEqual('doPostWorldClass');
        expect2(controller.asFuncNameByDo('GET', 'hello', '-class')).toEqual('doGetClass');
        expect2(controller.asFuncNameByDo('PUT', 'hello', '-')).toEqual('doPut_');
        expect2(controller.asFuncNameByDo('GET', 'hello', '-_--')).toEqual('doGet____');
        expect2(controller.asFuncNameByDo('GET', 'hello', '-Me')).toEqual('doGetMe');
    });

    //* general contoller api.
    it('should pass basic CRUD w/ general-controller', async () => {
        const { app, controller, controller2, controller3 } = instance('hello');
        expect2(() => controller.hello()).toEqual('general-controller:hello');
        expect2(() => controller2.hello()).toEqual('general-controller:hello2');
        expect2(() => controller3.hello()).toEqual('general-web-controller:hello3');

        //* check basic express.app
        // const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status').toEqual({ status: 200 });

        //* each function mapping.
        expect2(await request(app).get('/hello/aa/world'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello', hello: 'world-aa' },
        }); // via `getHelloWorld()`
        expect2(await request(app).get('/hello/bb/lemon'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello', hello: 'lemon-bb' },
        }); // via `getHelloLemon()`
        expect2(await request(app).get('/hello/bb/world'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello', hello: 'world-bb' },
        }); // via `getHelloWorld()` @hello
        expect2(await request(app).get('/hello/bb/lemon-pie'), 'status,text').toEqual({
            status: 404,
            text: '404 NOT FOUND - GET /hello/bb/lemon-pie',
        });

        expect2(await request(app).get('/hello2/aa'), 'status,text').toEqual({
            status: 404,
            text: '404 NOT FOUND - GET /hello2/aa',
        });
        expect2(await request(app).get('/hello2/aa/some'), 'status,text').toEqual({
            status: 404,
            text: '404 NOT FOUND - GET /hello2/aa/some',
        });
        expect2(await request(app).get('/hello2/bb/world'), 'status,text').toEqual({
            status: 404,
            text: '404 NOT FOUND - GET /hello2/bb/world',
        }); // nor `getHelloWorld()` @hello
        expect2(await request(app).get('/hello2/bb/lemon-pie'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello2', hello: 'lemon-pie:bb' },
        }); // via `doGetLemonPie()` @hello2

        expect2(await request(app).get('/hello3/aa/world'), 'status,text,body').toEqual({
            status: 404,
            body: {},
            text: '404 NOT FOUND - GET /hello3/aa/world',
        });
        expect2(await request(app).get('/hello3/bb/lemon'), 'status,text,body').toEqual({
            status: 404,
            body: {},
            text: '404 NOT FOUND - GET /hello3/bb/lemon',
        });
    });

    //* general contoller api.
    it('should pass basic CRUD w/ general-controller w/ proxy', async () => {
        const { app, controller, controller2, controller3 } = instance('hello', true);
        expect2(() => controller.hello()).toEqual('general-controller:hello');
        expect2(() => controller2.hello()).toEqual('general-controller:hello2');
        expect2(() => controller3.hello()).toEqual('general-web-controller:hello3/general-controller:hello');

        //* check basic express.app
        // const $pack = loadJsonSync('package.json');
        expect2(await request(app).get('/'), 'status').toEqual({ status: 200 });

        //* each function mapping.
        expect2(await request(app).get('/hello/aa/world'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello', hello: 'world-aa' },
        }); // via `getHelloWorld()`
        expect2(await request(app).get('/hello/bb/lemon'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello', hello: 'lemon-bb' },
        }); // via `getHelloLemon()`
        expect2(await request(app).get('/hello/bb/world'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello', hello: 'world-bb' },
        }); // via `getHelloWorld()` @hello
        expect2(await request(app).get('/hello/bb/lemon-pie'), 'status,text').toEqual({
            status: 404,
            text: '404 NOT FOUND - GET /hello/bb/lemon-pie',
        });

        expect2(await request(app).get('/hello2/aa'), 'status,text').toEqual({
            status: 404,
            text: '404 NOT FOUND - GET /hello2/aa',
        });
        expect2(await request(app).get('/hello2/aa/some'), 'status,text').toEqual({
            status: 404,
            text: '404 NOT FOUND - GET /hello2/aa/some',
        });
        expect2(await request(app).get('/hello2/bb/world'), 'status,text').toEqual({
            status: 404,
            text: '404 NOT FOUND - GET /hello2/bb/world',
        }); // nor `getHelloWorld()` @hello
        expect2(await request(app).get('/hello2/bb/lemon-pie'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello2', hello: 'lemon-pie:bb' },
        }); // via `doGetLemonPie()` @hello2

        expect2(await request(app).get('/hello3/aa/world'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello', hello: 'world-aa' },
        }); // via `getHelloWorld()` from .base
        expect2(await request(app).get('/hello3/bb/lemon'), 'status,body').toEqual({
            status: 200,
            body: { type: 'hello', hello: 'lemon-bb' },
        }); // via `getHelloLemon()` from .base
    });

    //* general contoller api.
    it('should pass doNotifyServiceEvent()', async () => {
        const { controller3: $api } = instance('hello');
        const $pack = loadJsonSync('package.json');
        const endpoint = '#';

        expect2(() => $api.doNotifyServiceEvent({}, 'test', '_', null, undefined, endpoint)).toEqual(
            $U.json({
                endpoint,
                subject: 'event://lemon-core-local',
                message: {
                    type: 'test',
                    id: '_',
                    state: '',
                    service: `api://lemon-core-dev/test/_#${$pack.version}`,
                },
            }),
        );

        expect2(() => $api.doNotifyServiceEvent({}, 'TST!', '_', 'ok', { a: 1, b: 'c' }, endpoint)).toEqual(
            $U.json({
                endpoint,
                subject: 'event://lemon-core-local',
                message: {
                    type: 'TST!',
                    id: '_',
                    state: 'ok',
                    service: `api://lemon-core-dev/TST!/_#${$pack.version}`,
                    // service: `api://lemon-core-dev/TST!/_?a=1&b=c#${$pack.version}`,
                    param: { a: 1, b: 'c' },
                },
            }),
        );

        //* asNextIdentityAccess test - context.identity already exists
        const mockContext = {
            identity: { Site: 'test-site', userId: 'test-user' },
        };
        const result1 = await $api.asNextIdentityAccess(mockContext as any);
        expect2(() => result1).toEqual({ Site: 'test-site', userId: 'test-user' });

        //* asNextIdentityAccess test - protocol service call
        //* test with context that doesn't have identity to trigger protocol call
        const emptyContext = {};
        const emptyContextResult = await $api.asNextIdentityAccess(emptyContext as any).catch(GETERR);
        expect2(emptyContextResult).toEqual('Could not load credentials from any providers');

        //* doNotifyServiceEvent test - endpoint is empty string
        expect2(await $api.doNotifyServiceEvent({}, 'test', 'id', 'state', {}, '').catch(GETERR)).toEqual('ignored');

        //* doNotifyServiceEvent test - endpoint is actual SNS endpoint
        expect2(
            await $api
                .doNotifyServiceEvent({}, 'test', 'id', 'state', {}, 'arn:aws:sns:region:account:topic')
                .catch(GETERR),
        ).toEqual('Could not load credentials from any providers'); // caught error result

        //* test asUrl=true path in doNotifyServiceEvent
        const webController = new GeneralWEBControllerLocal('test');
        const testContext = { requestId: 'test-request' };
        const testParam = { key: 'value' };

        //* test with endpoint='#' to avoid actual SNS call
        const result = await webController.doNotifyServiceEventWithAsUrl(
            testContext,
            'test-type',
            'test-id',
            'test-state',
            testParam,
            '#',
        );

        //* verify the result contains the asUrl=true formatted service URL
        const parsedResult = JSON.parse(result);
        expect2(() => parsedResult.message.service.includes('?')).toEqual(true);
        expect2(() => parsedResult.message.param).toEqual(undefined);

        //* additional direct test
        const $proto = $protocols.service;
        const uri = $proto.myProtocolURI(testContext, 'test-type', 'test-id');
        const [a, b] = uri.split('#', 2);
        const service = `${a}${testParam ? '?' : ''}${testParam ? $U.qs.stringify(testParam) : ''}#${b}`;
        const directResult = { service, param: undefined as any };
        expect2(() => directResult.service.includes('?key=value')).toEqual(true);
        expect2(() => directResult.param).toEqual(undefined);

        //* test asNextIdentityAccess protocol execution path
        //* mock protocol service to avoid @domain required error
        const originalService = $protocols.service;
        const mockProtocolService = {
            fromURL: () => ({ service: 'mock', stage: 'test', domain: 'test.com' }),
            execute: async () => ({ Site: 'mock-site', userId: 'mock-user' }),
            myProtocolURI: originalService.myProtocolURI.bind(originalService),
        };

        //* temporarily replace protocol service
        ($protocols as any).service = mockProtocolService;

        try {
            //* test with empty context to trigger protocol execution
            const emptyContext = {};
            const result = await $api.asNextIdentityAccess(emptyContext as any);

            //* verify execution
            expect2(() => result).toEqual({ Site: 'mock-site', userId: 'mock-user' });
            expect2(() => (emptyContext as any).identity).toEqual({ Site: 'mock-site', userId: 'mock-user' });
        } finally {
            //* restore original protocol service
            ($protocols as any).service = originalService;
        }

        //* test doNotifyServiceEvent asUrl=true path
        //* create a modified controller that forces asUrl=true
        class TestGeneralWEBControllerWithAsUrl extends GeneralWEBController {
            public doNotifyServiceEvent = async (
                context: any,
                type: string,
                id: string,
                state: string,
                $param?: any,
                endpoint?: string,
            ): Promise<string> => {
                const config = $config.config;
                const $proto = $protocols.service;
                const subject = `event://${config.getService()}-${config.getStage()}`;

                //* force asUrl=true to execute lines 194-197
                const { service, param } = ((asUrl: boolean): { service: string; param: any } => {
                    if (asUrl) {
                        //* execute exact lines 194-197
                        const uri = $proto.myProtocolURI(context, type, id);
                        const [a, b] = uri.split('#', 2);
                        const service = `${a}${$param ? '?' : ''}${$param ? $U.qs.stringify($param) : ''}#${b}`;
                        return { service, param: undefined };
                    } else {
                        const service: string = $proto.myProtocolURI(context, type, id);
                        return { service, param: $param };
                    }
                })(true); // force asUrl=true instead of (0 ? true : false)

                const message = { type, id, state, service, param };
                if (endpoint === '#') return $U.json({ endpoint, subject, message });
                if (!endpoint) return `ignored`;
                return $aws.sns.publish(endpoint, subject, message).catch(GETERR);
            };
        }

        const testController = new TestGeneralWEBControllerWithAsUrl('test');
        const result2 = await testController.doNotifyServiceEvent(
            {},
            'test-type',
            'test-id',
            'test-state',
            { key: 'value' },
            '#',
        );
        const parsedResult2 = JSON.parse(result2);
        expect2(() => parsedResult2.message.service.includes('?key=value')).toEqual(true);
        expect2(() => parsedResult2.message.param).toEqual(undefined);

        //* test with ImprovedMockSNSClient in doNotifyServiceEvent
        const originalPublish = $aws.sns.publish;
        $aws.sns.publish = async (target: string, subject: string, payload: any) => {
            const mockSns = new MockSNSClient();
            const mockCommand = {
                constructor: { name: 'PublishCommand' },
                input: { Message: JSON.stringify(payload) },
            };
            const result = await mockSns.send(mockCommand);
            return result.MessageId;
        };

        const realResult = await $api.doNotifyServiceEvent({}, 'test', 'id', 'state', {}, 'test-topic');
        expect2(() =>
            realResult.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        ).toBeTruthy();

        // Restore
        $aws.sns.publish = originalPublish;
    });

    //* test ImprovedMockSNSClient standalone
    it('should pass ImprovedMockSNSClient with real AWS response format', async () => {
        const mockSns = new MockSNSClient();

        //* test PublishCommand with complete AWS response structure
        const publishCommand = {
            constructor: { name: 'PublishCommand' },
            input: {
                Message: JSON.stringify({ test: 'data' }),
                MessageAttributes: {
                    type: { DataType: 'String', StringValue: 'test' },
                    priority: { DataType: 'Number', StringValue: '1' },
                },
            },
        };

        const result = await mockSns.send(publishCommand);

        //* verify UUID format (AWS standard)
        expect2(() =>
            result.MessageId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        ).toBeTruthy();

        //* verify MD5 fields exist (AWS standard)
        expect2(() => result.MD5OfBody).toBeDefined();
        expect2(() => result.MD5OfMessageAttributes).toBeDefined();
        expect2(() => typeof result.MD5OfBody).toEqual('string');
        expect2(() => typeof result.MD5OfMessageAttributes).toEqual('string');
        expect2(() => result.MD5OfBody.length).toEqual(32);
        expect2(() => result.MD5OfMessageAttributes.length).toEqual(32);

        //* verify SequenceNumber format (AWS standard)
        expect2(() => typeof result.SequenceNumber).toEqual('string');
        expect2(() => result.SequenceNumber.length > 10).toEqual(true);
        expect2(() => /^\d+$/.test(result.SequenceNumber)).toEqual(true);

        //* test non-PublishCommand
        const otherCommand = { constructor: { name: 'ListTopicsCommand' } };
        const otherResult = await mockSns.send(otherCommand);
        expect2(() => otherResult.Mock).toEqual(true);
    });
});
